-- 138 — Transferência entre locais no modo 'proprio' (a tela de Transferências de sempre, sem Omie).
-- Aditiva. A transferência continua sendo um documento (`transferencias` + itens em `movimentos`); em loja 'proprio' cada
-- item lançado vira um PAR de movimentos no ledger (saída na origem, entrada no destino), na mesma transação, custo inalterado.
-- Aplicar: docker exec -i supabase-db psql -U supabase_admin -d postgres < 138_transferencia_proprio.sql

alter table public.movimentos add column if not exists ledger_ref text;
alter table public.movimentos add column if not exists ledger_versao int not null default 0;

-- Estorno de perna de transferência continua sendo TRANSFERÊNCIA (não muda o custo médio); o resto segue como EST.
create or replace function public.estornar_movimento(p_id bigint, p_user text default null, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m estoque_movimentos%rowtype;
begin
  select * into m from estoque_movimentos where id = p_id;
  if not found then raise exception 'Movimento % não existe', p_id using errcode = '22023'; end if;
  if m.tipo = 'EST' or m.reverses_id is not null then raise exception 'Estorno não se estorna' using errcode = '22023'; end if;
  return registrar_movimento(m.loja_id, m.codigo_local_estoque, m.codigo_produto,
                             case when m.tipo = 'TRF' then 'TRF' else 'EST' end, 'ESTORNO', 'mov:' || m.id,
                             -m.quantidade, m.custo_unitario, p_user, coalesce(p_obs, 'Estorno do movimento ' || m.id),
                             0, m.id, m.transferencia_ref, null);
end $$;

-- Desfaz o lançamento atual de um item de transferência (estorna as duas pernas ainda não estornadas).
create or replace function public.trf_desfazer_lancamento(p_loja bigint, p_ref text, p_user text) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select m.id from estoque_movimentos m
     where m.loja_id = p_loja and m.origem = 'TRANSFERENCIA' and m.ref = p_ref
       and not exists (select 1 from estoque_movimentos x where x.reverses_id = m.id)
     order by m.id
  loop
    perform estornar_movimento(r.id, p_user, 'Transferência alterada: lançamento anterior estornado');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Lança (ou relança) UM item de transferência no ledger. Idempotente por versão: mexer na quantidade estorna o lançamento
-- anterior e lança de novo com ref nova (trf:<item>:v<n>). Atômico: tudo na mesma transação da função.
create or replace function public.lancar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text default null, p_obs text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; mv movimentos%rowtype; v_de bigint; v_para bigint; v_ref text; v_res jsonb; v_cmc numeric;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  select * into mv from movimentos where id = p_movimento and loja_id = p_loja for update;
  if not found then raise exception 'Item de transferência % não existe', p_movimento using errcode = '22023'; end if;
  if mv.transferencia_id is null then raise exception 'Movimento % não pertence a uma transferência', p_movimento using errcode = '22023'; end if;
  if mv.quan is null or mv.quan <= 0 then raise exception 'Informe uma quantidade maior que zero' using errcode = '22023'; end if;
  v_de := mv.codigo_local_estoque; v_para := mv.codigo_local_estoque_destino;
  if v_de is null or v_para is null or v_de = v_para then raise exception 'Origem e destino precisam ser locais diferentes' using errcode = '22023'; end if;

  if mv.ledger_ref is not null then
    perform trf_desfazer_lancamento(p_loja, mv.ledger_ref, p_user);
  end if;
  v_ref := 'trf:' || p_movimento || ':v' || (mv.ledger_versao + 1);
  v_res := transferir_estoque(p_loja, v_de, v_para, mv.id_prod, mv.quan, v_ref, p_user, p_obs);
  select cmc into v_cmc from estoque_custos where loja_id = p_loja and codigo_produto = mv.id_prod;

  update movimentos
     set ledger_ref = v_ref, ledger_versao = mv.ledger_versao + 1, status = 'Concluido', valor = v_cmc,
         codigo_status = null, descricao_status = null, response = null, tentativas = 0, updated_at = now()
   where id = p_movimento;
  return jsonb_build_object('ok', true, 'ref', v_ref, 'cmc', v_cmc, 'saida', v_res -> 'saida', 'entrada', v_res -> 'entrada');
end $$;

-- Remove o lançamento de um item (zerou a quantidade ou excluiu o item): estorna as pernas e deixa o item sem lançamento.
create or replace function public.estornar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_modo text; mv movimentos%rowtype; n int := 0;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  select * into mv from movimentos where id = p_movimento and loja_id = p_loja for update;
  if not found then raise exception 'Item de transferência % não existe', p_movimento using errcode = '22023'; end if;
  if mv.ledger_ref is not null then
    n := trf_desfazer_lancamento(p_loja, mv.ledger_ref, p_user);
    update movimentos set ledger_ref = null, status = 'Iniciado', valor = null, updated_at = now() where id = p_movimento;
  end if;
  return jsonb_build_object('ok', true, 'estornados', n);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'trf_desfazer_lancamento(bigint,text,text)',
    'lancar_transferencia_item(bigint,bigint,text,text)',
    'estornar_transferencia_item(bigint,bigint,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
