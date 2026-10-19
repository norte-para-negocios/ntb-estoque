-- 231 — Fase F [H1]: devolução ao fornecedor no estoque próprio, SEM emitir NF-e.
-- Plano: docs/superpowers/plans/2026-10-19-fase-f-contador.md (R9). Depende da 230 (_exigir_periodo_aberto).
--
-- A devolução é um documento ligado a uma nota de entrada lançada (compras_proprio): itens e quantidades (unidade de
-- estoque), motivo, situação "a_emitir" ("Devolução a emitir"). Ao registrar, as unidades saem do estoque pelo ledger
-- ao CUSTO DA ENTRADA ORIGINAL e o custo médio é refeito sem elas (HIPÓTESE: sem kardex de devolução do Omie capturado):
-- C₁ = (S₀·C₀ − q·c)/(S₀ − q); saldo que zera/fica negativo ou resultado ≤ 0 mantém C₀. Cancelar = estorno de cada
-- saída (volta ao custo da saída). A emissão da NF-e de devolução fica para depois (OK do dono + SEFAZ): 'emitida' é só
-- reservada. "Desfazer entrada" de nota com devolução não cancelada é recusado (senão as unidades sairiam duas vezes).
-- Lojas Omie não usam nada disto (no Omie a devolução é feita no Omie).
--
-- SÓ ADITIVA. Aplicar (manual, com backup e OK do dono), DEPOIS da 230:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 231_devolucao_fornecedor.sql
-- Depois: NOTIFY pgrst; desktop/scripts/gerar-schema.sh + versão nova do app desktop.
-- Teste: scripts/testes-sql/231_devolucao_fornecedor.sql (banco local).

begin;

insert into permissoes (nome) values ('Compras - Devolucao ao fornecedor') on conflict (nome) do nothing;

create table if not exists public.devolucoes_fornecedor (
  id                  bigint generated always as identity primary key,
  loja_id             bigint not null references public.lojas(id),
  numero              int not null,
  compra_id           bigint not null references public.compras_proprio(id),
  nota_fiscal_id      bigint,
  fornecedor_nome     text,
  fornecedor_cnpj     text,
  chave_nota_origem   text,
  numero_nota_origem  text,
  motivo              text not null check (btrim(motivo) <> ''),
  situacao            text not null default 'a_emitir' check (situacao in ('a_emitir', 'emitida', 'cancelada')),
  data                date not null default ((now() at time zone 'America/Bahia')::date),
  valor_custo         numeric(18,2) not null default 0,
  valor_fiscal        numeric(18,2) not null default 0,
  chave_idempotencia  text,
  criado_por          text,
  criado_por_nome     text,
  cancelado_por       text,
  cancelado_por_nome  text,
  cancelado_em        timestamptz,
  motivo_cancelamento text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (loja_id, numero),
  unique (loja_id, chave_idempotencia)
);
create index if not exists devolucoes_fornecedor_compra on public.devolucoes_fornecedor (loja_id, compra_id);

create table if not exists public.devolucoes_fornecedor_itens (
  id                    bigint generated always as identity primary key,
  devolucao_id          bigint not null references public.devolucoes_fornecedor(id),
  loja_id               bigint not null references public.lojas(id),
  compra_item_id        bigint not null references public.compras_proprio_itens(id),
  linha                 int not null,
  codigo_produto        bigint not null,
  descricao             text,
  codigo_local_estoque  bigint not null,
  quantidade            numeric(18,6) not null check (quantidade > 0),   -- unidade de estoque
  custo_unitario        numeric(18,6) not null default 0,                -- custo da entrada original
  valor_custo           numeric(18,2) not null default 0,
  valor_fiscal          numeric(18,2) not null default 0,                -- proporcional ao valor do item na nota
  cfop                  text check (cfop is null or cfop ~ '^[56]\.[0-9]{3}$'),
  movimento_id          bigint,
  estorno_movimento_id  bigint,
  unique (devolucao_id, compra_item_id)
);
create index if not exists devolucoes_fornecedor_itens_item on public.devolucoes_fornecedor_itens (compra_item_id);

create table if not exists public.devolucoes_fornecedor_eventos (
  id           bigint generated always as identity primary key,
  loja_id      bigint not null references public.lojas(id),
  devolucao_id bigint not null references public.devolucoes_fornecedor(id),
  tipo         text not null check (tipo in ('registrada', 'cancelada', 'emitida')),
  detalhe      jsonb not null default '{}'::jsonb,
  user_id      text,
  user_nome    text,
  created_at   timestamptz not null default now()
);
create index if not exists devolucoes_fornecedor_eventos_dev on public.devolucoes_fornecedor_eventos (devolucao_id, id);

create or replace function public.trg_devolucoes_fornecedor_eventos_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'devolucoes_fornecedor_eventos é append-only' using errcode = '55000';
end $$;
drop trigger if exists devolucoes_fornecedor_eventos_imutavel on public.devolucoes_fornecedor_eventos;
create trigger devolucoes_fornecedor_eventos_imutavel before update or delete on public.devolucoes_fornecedor_eventos
  for each row execute function public.trg_devolucoes_fornecedor_eventos_imutavel();

do $$ declare t text; begin
  foreach t in array array['devolucoes_fornecedor', 'devolucoes_fornecedor_itens', 'devolucoes_fornecedor_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Saída do ledger ao custo da entrada original, com o custo médio refeito sem as unidades devolvidas. Mesma ordem de
-- trava e mesmas projeções do registrar_movimento (132/174); idempotente pela mesma chave (origem, ref, produto, local, linha).
create or replace function public._saida_ao_custo_da_entrada(
  p_loja bigint, p_local bigint, p_produto bigint, p_ref text, p_linha int, p_quantidade numeric, p_custo numeric,
  p_user text default null, p_obs text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_custos estoque_custos%rowtype; v_saldo_ant numeric; v_saldo_novo numeric; v_total_novo numeric; v_cmc_novo numeric;
  v_exist estoque_movimentos%rowtype; v_id bigint; v_q numeric := abs(p_quantidade);
begin
  if v_q = 0 then raise exception 'Quantidade zero' using errcode = '22023'; end if;
  select * into v_exist from estoque_movimentos
   where loja_id = p_loja and origem = 'DEVOLUCAO_FORNECEDOR' and ref = p_ref and codigo_produto = p_produto
     and codigo_local_estoque = p_local and linha = p_linha;
  if found then return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'cmc', v_exist.cmc_apos); end if;

  insert into estoque_custos (loja_id, codigo_produto) values (p_loja, p_produto) on conflict do nothing;
  select * into v_custos from estoque_custos where loja_id = p_loja and codigo_produto = p_produto for update;
  insert into estoque_saldos (loja_id, codigo_local_estoque, codigo_produto) values (p_loja, p_local, p_produto) on conflict do nothing;
  select saldo into v_saldo_ant from estoque_saldos
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto for update;

  v_saldo_novo := v_saldo_ant - v_q;
  v_total_novo := v_custos.saldo_total - v_q;
  -- HIPÓTESE (R9): refaz o custo médio sem as unidades devolvidas; saldo ≤ 0 ou resultado ≤ 0 mantém o custo médio
  if v_total_novo > 0 and coalesce(p_custo, 0) > 0 then
    v_cmc_novo := round((v_custos.saldo_total * v_custos.cmc - v_q * p_custo) / v_total_novo, 6);
    if v_cmc_novo <= 0 then v_cmc_novo := v_custos.cmc; end if;
  else
    v_cmc_novo := v_custos.cmc;
  end if;

  insert into estoque_movimentos (loja_id, codigo_local_estoque, codigo_produto, tipo, origem, ref, linha, quantidade,
      custo_unitario, saldo_apos, saldo_total_apos, cmc_apos, custo_estimado, user_id, obs, data_ref)
  values (p_loja, p_local, p_produto, 'SAI', 'DEVOLUCAO_FORNECEDOR', p_ref, p_linha, -v_q,
      coalesce(nullif(p_custo, 0), v_custos.cmc), v_saldo_novo, v_total_novo, v_cmc_novo, coalesce(p_custo, 0) <= 0, p_user, p_obs,
      (now() at time zone 'America/Sao_Paulo')::date)
  returning id into v_id;

  update estoque_saldos set saldo = v_saldo_novo, updated_at = now()
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto;
  update estoque_custos set cmc = v_cmc_novo, saldo_total = v_total_novo, updated_at = now()
   where loja_id = p_loja and codigo_produto = p_produto;

  insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, c_codigo, c_descricao, n_saldo, fisico, n_cmc, estoque_minimo)
  select p_loja, p_local, p_produto, (now() at time zone 'America/Sao_Paulo')::date, pr.codigo, pr.descricao,
         v_saldo_novo, v_saldo_novo, v_cmc_novo, pr.estoque_minimo
    from (select 1) x left join produtos pr on pr.loja_id = p_loja and pr.codigo_produto = p_produto
  on conflict (loja_id, codigo_local_estoque, n_cod_prod, data_posicao)
  do update set n_saldo = excluded.n_saldo, fisico = excluded.fisico, n_cmc = excluded.n_cmc, updated_at = now();

  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_id, 'saldo', v_saldo_novo, 'cmc', v_cmc_novo, 'negativo', v_saldo_novo < 0);
end $$;

-- p_itens: [{compra_item_id, quantidade (unidade de estoque), cfop ('5.202')}]
create or replace function public.devolucao_fornecedor_registrar(
  p_loja bigint, p_compra bigint, p_itens jsonb, p_motivo text, p_user text default null, p_user_nome text default null, p_chave text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c compras_proprio%rowtype; v_dev devolucoes_fornecedor%rowtype; d record; it compras_proprio_itens%rowtype; m estoque_movimentos%rowtype;
  v_q numeric; v_ja numeric; v_disp numeric; v_numero int; v_custo numeric; v_fiscal numeric; v_valor_item numeric; r jsonb;
  v_tot_custo numeric := 0; v_tot_fiscal numeric := 0; v_n int := 0; v_nf notas_fiscais%rowtype;
begin
  if (select modo_estoque from lojas where id = p_loja) is distinct from 'proprio' then
    raise exception 'Devolução ao fornecedor pelo app só existe na loja de estoque próprio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then raise exception 'Informe o motivo da devolução' using errcode = '22023'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Escolha pelo menos um item para devolver' using errcode = '22023';
  end if;

  select * into c from compras_proprio where id = p_compra and loja_id = p_loja for update;
  if not found then raise exception 'Nota de entrada não encontrada nesta loja' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_chave, '')), '') is not null then
    select * into v_dev from devolucoes_fornecedor where loja_id = p_loja and chave_idempotencia = btrim(p_chave);
    if found then return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_dev.id, 'numero', v_dev.numero); end if;
  end if;
  if c.status not in ('lancada', 'parcial') then
    raise exception 'Só dá para devolver itens de uma nota que entrou no estoque' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(7231, p_loja::int);
  select coalesce(max(numero), 0) + 1 into v_numero from devolucoes_fornecedor where loja_id = p_loja;
  select * into v_nf from notas_fiscais where id = c.nota_fiscal_id and loja_id = p_loja;
  insert into devolucoes_fornecedor (loja_id, numero, compra_id, nota_fiscal_id, fornecedor_nome, fornecedor_cnpj, chave_nota_origem,
      numero_nota_origem, motivo, chave_idempotencia, criado_por, criado_por_nome)
  values (p_loja, v_numero, c.id, c.nota_fiscal_id, c.fornecedor_nome, c.fornecedor_cnpj, c.chave_acesso, c.numero, btrim(p_motivo),
      nullif(btrim(coalesce(p_chave, '')), ''), p_user, p_user_nome)
  returning * into v_dev;

  for d in select value as x from jsonb_array_elements(p_itens) loop
    v_q := round(coalesce(nullif(d.x->>'quantidade', '')::numeric, 0), 6);
    if v_q <= 0 then raise exception 'A quantidade devolvida precisa ser maior que zero' using errcode = '22023'; end if;
    select * into it from compras_proprio_itens where id = (d.x->>'compra_item_id')::bigint and compra_id = c.id and loja_id = p_loja for update;
    if not found or not it.lancado or it.movimento_id is null then
      raise exception 'Um dos itens não é desta nota ou não entrou no estoque' using errcode = '22023';
    end if;
    select * into m from estoque_movimentos where id = it.movimento_id and loja_id = p_loja;
    if not found or m.quantidade <= 0 then raise exception 'Entrada do item % não encontrada no estoque', it.linha using errcode = '22023'; end if;
    select coalesce(sum(di.quantidade), 0) into v_ja
      from devolucoes_fornecedor_itens di join devolucoes_fornecedor dv on dv.id = di.devolucao_id
     where di.compra_item_id = it.id and dv.situacao <> 'cancelada';
    v_disp := round(m.quantidade - v_ja, 6);
    if v_q > v_disp then
      raise exception 'Item %: quantidade maior do que ainda dá para devolver (%)', it.linha, v_disp using errcode = '22023';
    end if;
    v_custo := coalesce(nullif(m.custo_unitario, 0), it.custo_unitario_base, 0);
    v_valor_item := coalesce(it.valor_total_item, it.valor_total - coalesce(it.desconto, 0), 0);
    v_fiscal := round(v_valor_item * v_q / m.quantidade, 2);
    r := _saida_ao_custo_da_entrada(p_loja, m.codigo_local_estoque, m.codigo_produto, 'dev:' || v_dev.id, it.linha, v_q, v_custo,
                                    p_user, 'Devolução ao fornecedor nº ' || v_numero || ' (nota ' || coalesce(c.numero, c.id::text) || ')');
    insert into devolucoes_fornecedor_itens (devolucao_id, loja_id, compra_item_id, linha, codigo_produto, descricao, codigo_local_estoque,
        quantidade, custo_unitario, valor_custo, valor_fiscal, cfop, movimento_id)
    values (v_dev.id, p_loja, it.id, it.linha, m.codigo_produto, it.descricao, m.codigo_local_estoque, v_q, v_custo,
        round(v_q * v_custo, 2), v_fiscal, nullif(d.x->>'cfop', ''), (r->>'id')::bigint);
    v_tot_custo := v_tot_custo + round(v_q * v_custo, 2); v_tot_fiscal := v_tot_fiscal + v_fiscal; v_n := v_n + 1;
  end loop;

  update devolucoes_fornecedor set valor_custo = v_tot_custo, valor_fiscal = v_tot_fiscal, updated_at = now() where id = v_dev.id;
  insert into devolucoes_fornecedor_eventos (loja_id, devolucao_id, tipo, detalhe, user_id, user_nome)
  values (p_loja, v_dev.id, 'registrada', jsonb_build_object('itens', v_n, 'valor_custo', v_tot_custo, 'valor_fiscal', v_tot_fiscal), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_dev.id, 'numero', v_numero, 'itens', v_n,
                            'valor_custo', v_tot_custo, 'valor_fiscal', v_tot_fiscal);
end $$;

-- Cancela a devolução ainda não emitida: cada saída é estornada (volta ao custo da saída), situação 'cancelada'.
create or replace function public.devolucao_fornecedor_cancelar(
  p_loja bigint, p_id bigint, p_user text default null, p_user_nome text default null, p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dev devolucoes_fornecedor%rowtype; i record; r jsonb; n int := 0;
begin
  select * into v_dev from devolucoes_fornecedor where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Devolução não encontrada nesta loja' using errcode = '22023'; end if;
  if v_dev.situacao = 'cancelada' then return jsonb_build_object('ok', true, 'duplicado', true); end if;
  if v_dev.situacao <> 'a_emitir' then raise exception 'Devolução com NF-e emitida não se cancela por aqui' using errcode = '22023'; end if;
  perform _exigir_periodo_aberto(p_loja, v_dev.data, 'devolução ao fornecedor');
  for i in select * from devolucoes_fornecedor_itens where devolucao_id = v_dev.id and movimento_id is not null and estorno_movimento_id is null order by linha loop
    r := estornar_movimento(i.movimento_id, p_user, 'Cancelamento da devolução ao fornecedor nº ' || v_dev.numero);
    update devolucoes_fornecedor_itens set estorno_movimento_id = (r->>'id')::bigint where id = i.id;
    n := n + 1;
  end loop;
  update devolucoes_fornecedor set situacao = 'cancelada', cancelado_por = p_user, cancelado_por_nome = p_user_nome, cancelado_em = now(),
         motivo_cancelamento = nullif(btrim(coalesce(p_motivo, '')), ''), updated_at = now()
   where id = v_dev.id;
  insert into devolucoes_fornecedor_eventos (loja_id, devolucao_id, tipo, detalhe, user_id, user_nome)
  values (p_loja, v_dev.id, 'cancelada', jsonb_build_object('estornados', n, 'motivo', p_motivo), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'estornados', n);
end $$;

-- Desfazer a entrada (estornar_compra) de item com devolução não cancelada: recusa (as unidades sairiam duas vezes).
create or replace function public.trg_compras_itens_devolucao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_num int;
begin
  if coalesce(old.lancado, false) and (tg_op = 'DELETE' or not coalesce(new.lancado, false)) then
    select dv.numero into v_num from devolucoes_fornecedor_itens di join devolucoes_fornecedor dv on dv.id = di.devolucao_id
     where di.compra_item_id = old.id and dv.situacao <> 'cancelada' limit 1;
    if found then
      raise exception 'Esta nota tem devolução ao fornecedor registrada (nº %): cancele a devolução antes de desfazer a entrada', v_num using errcode = '22023';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists compras_itens_devolucao on public.compras_proprio_itens;
create trigger compras_itens_devolucao before update of lancado or delete on public.compras_proprio_itens
  for each row execute function public.trg_compras_itens_devolucao();

do $$ declare f text; begin
  foreach f in array array[
    '_saida_ao_custo_da_entrada(bigint,bigint,bigint,text,int,numeric,numeric,text,text)',
    'devolucao_fornecedor_registrar(bigint,bigint,jsonb,text,text,text,text)',
    'devolucao_fornecedor_cancelar(bigint,bigint,text,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.trg_compras_itens_devolucao() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
