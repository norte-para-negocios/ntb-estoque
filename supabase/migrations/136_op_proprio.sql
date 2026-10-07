-- 136 — Ordem de Produção no estoque próprio (06/10/2026).
-- A OP de uma loja 'proprio' vive na MESMA tabela `ordens_producao` que a tela de OPs já lê (lista, filtros, exportações,
-- relatórios e etiquetas funcionam sem mudança). O que muda é o motor: concluir/reverter/excluir movem o ledger local
-- (`produzir` da migration 133) em vez de chamar o Omie. Aditiva: lojas 'omie' e 'nenhum' não passam por nada daqui.
-- Aplicar: docker exec -i supabase-db psql -U supabase_admin -d postgres < 136_op_proprio.sql

alter table public.ordens_producao add column if not exists local_destino bigint;          -- null = mesmo local de consumo
alter table public.ordens_producao add column if not exists producao_ref  text;            -- ref da última conclusão no ledger
alter table public.ordens_producao add column if not exists producao_n    int not null default 0;

create sequence if not exists public.seq_op_proprio start 8000000000001;

create table if not exists public.op_numeracao (
  loja_id bigint not null references public.lojas(id),
  ano     int    not null,
  ultimo  int    not null default 0,
  primary key (loja_id, ano)
);
alter table public.op_numeracao enable row level security;
revoke all on public.op_numeracao from anon, authenticated;
grant all on public.op_numeracao to service_role;

-- Cria a OP (aberta, sem mexer em estoque). Número no formato AAAA/00001 por loja e ano, como o das OPs do Omie.
create or replace function public.op_proprio_criar(
  p_loja bigint, p_produto bigint, p_data date, p_qtde numeric, p_local bigint default null, p_local_destino bigint default null,
  p_validade date default null, p_obs text default null, p_user text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; v_pr produtos%rowtype; v_local bigint; v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  v_n int; v_cod bigint; v_num text; v_id bigint; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_qtde is null or p_qtde <= 0 then raise exception 'Informe a quantidade' using errcode = '22023'; end if;
  select * into v_pr from produtos where loja_id = p_loja and codigo_produto = p_produto;
  if not found then raise exception 'Produto % não existe nesta loja', p_produto using errcode = '22023'; end if;
  v_local := coalesce(p_local, (select codigo_local_estoque from local_estoques where loja_id = p_loja and padrao = 'S' order by id limit 1));
  if v_local is not null and not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = v_local) then
    raise exception 'Local de estoque inexistente' using errcode = '22023';
  end if;
  if p_local_destino is not null and not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local_destino) then
    raise exception 'Local de destino inexistente' using errcode = '22023';
  end if;

  insert into op_numeracao (loja_id, ano, ultimo) values (p_loja, v_ano, 1)
    on conflict (loja_id, ano) do update set ultimo = op_numeracao.ultimo + 1 returning ultimo into v_n;
  v_num := v_ano || '/' || lpad(v_n::text, 5, '0');
  v_cod := nextval('public.seq_op_proprio');

  insert into ordens_producao (
    loja_id, num_ordem, validade, identificacao_n_cod_op, identificacao_c_cod_int_op, identificacao_c_num_op,
    identificacao_n_cod_produto, identificacao_c_cod_int_prod, identificacao_d_dt_previsao, identificacao_n_qtde,
    identificacao_codigo_local_estoque, local_destino, adicionais_d_dt_inicio, produto_codigo, produto_descricao,
    produto_tipo_item, produto_unidade, concluida, dt_inclusao, observacao
  ) values (
    p_loja, v_num, p_validade, v_cod, 'NTB-' || v_cod, v_num,
    p_produto, v_pr.codigo, coalesce(p_data, v_hoje), p_qtde,
    v_local, p_local_destino, coalesce(p_data, v_hoje), v_pr.codigo, v_pr.descricao,
    v_pr.tipo_item, v_pr.unidade, false, v_hoje, nullif(btrim(concat_ws(' · ', p_obs, p_user)), '')
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'n_cod_op', v_cod, 'num_op', v_num);
end $$;

-- Conclui a OP: consome os insumos da ficha técnica e entrega o produto (ledger). Conclusão parcial = p_qtde menor que o previsto.
create or replace function public.op_proprio_concluir(
  p_loja bigint, p_op bigint, p_data date default null, p_qtde numeric default null, p_user text default null, p_user_uuid uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o ordens_producao%rowtype; v_qtd numeric; v_n int; v_ref text; v_consumo bigint; v_destino bigint; v_res jsonb;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if coalesce(o.concluida, false) then raise exception 'Esta OP já está concluída' using errcode = '22023'; end if;
  v_qtd := coalesce(nullif(p_qtde, 0), o.identificacao_n_qtde, 1);
  if v_qtd <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  v_consumo := coalesce(o.identificacao_codigo_local_estoque,
                        (select codigo_local_estoque from local_estoques where loja_id = p_loja and padrao = 'S' order by id limit 1));
  if v_consumo is null then raise exception 'A OP não tem local de estoque e a loja não tem local padrão' using errcode = '22023'; end if;
  v_destino := coalesce(o.local_destino, v_consumo);
  v_n := o.producao_n + 1;
  v_ref := 'OP:' || o.id || ':' || v_n;

  v_res := produzir(p_loja, o.identificacao_n_cod_produto, v_qtd, v_consumo, v_destino, v_ref, p_user,
                    'OP ' || coalesce(o.identificacao_c_num_op, o.id::text));

  update ordens_producao set
    concluida = true, dt_conclusao_real = least(coalesce(p_data, v_hoje), v_hoje), concluida_por = p_user_uuid,
    identificacao_n_qtde = v_qtd, producao_ref = v_ref, producao_n = v_n,
    conclusao_status = null, conclusao_erro_msg = null, conclusao_tentativas = 0, updated_at = now()
  where id = o.id;

  return v_res || jsonb_build_object('op_id', o.id, 'ref', v_ref);
end $$;

-- Reverte a conclusão: estorna no ledger cada movimento daquela produção (insumos e produto), volta a OP para aberta.
create or replace function public.op_proprio_reverter(p_loja bigint, p_op bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o ordens_producao%rowtype; m record; v_prods bigint[]; v_cont int := 0;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if not coalesce(o.concluida, false) then raise exception 'Só dá para reverter uma OP concluída' using errcode = '22023'; end if;
  if o.producao_ref is null then
    -- OP concluída sem rastro no ledger (não deveria acontecer em loja proprio): só reabre.
    update ordens_producao set concluida = false, dt_conclusao_real = null, updated_at = now() where id = o.id;
    return jsonb_build_object('ok', true, 'estornados', 0);
  end if;
  select array_agg(distinct codigo_produto order by codigo_produto) into v_prods
    from estoque_movimentos where loja_id = p_loja and origem = 'PRODUCAO' and ref = o.producao_ref;
  if v_prods is not null then perform _travar_custos(p_loja, v_prods); end if;
  for m in select id from estoque_movimentos where loja_id = p_loja and origem = 'PRODUCAO' and ref = o.producao_ref order by id desc loop
    perform estornar_movimento(m.id, p_user, 'Reversão da OP ' || coalesce(o.identificacao_c_num_op, o.id::text));
    v_cont := v_cont + 1;
  end loop;
  update ordens_producao_proprio set status = 'revertida' where loja_id = p_loja and ref = o.producao_ref;
  update ordens_producao set concluida = false, dt_conclusao_real = null, updated_at = now() where id = o.id;
  return jsonb_build_object('ok', true, 'estornados', v_cont);
end $$;

-- Exclui a OP (se concluída, reverte antes).
create or replace function public.op_proprio_excluir(p_loja bigint, p_op bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o ordens_producao%rowtype;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if coalesce(o.concluida, false) then perform op_proprio_reverter(p_loja, p_op, p_user); end if;
  delete from ordens_producao where id = p_op and loja_id = p_loja;
  return jsonb_build_object('ok', true);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'op_proprio_criar(bigint,bigint,date,numeric,bigint,bigint,date,text,text)',
    'op_proprio_concluir(bigint,bigint,date,numeric,text,uuid)',
    'op_proprio_reverter(bigint,bigint,text)',
    'op_proprio_excluir(bigint,bigint,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
