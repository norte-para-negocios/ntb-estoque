-- 160 — "Nosso Omie" Fase 1: base de dados do espelho completo do estoque Omie (spec 2026-10-13-nosso-omie-design.md).
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md). Depende da 159 (kardex_omie).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 160_espelho_completo.sql
-- Depois: desktop/scripts/gerar-schema.sh + versão nova do app desktop.
--
-- Conteúdo:
--  1. lojas.espelho_completo (ligada só na loja 5) — os crons novos só rodam onde ela está ligada.
--  2. espelho_sync_estado — cursor de cada cron por loja (kardex, ajustes, ops-abertas).
--  3. saldo_em_data(loja, data) — saldo e custo médio por produto/local numa data, pelo kardex_omie.
--  4. ordens_producao: origem, autor, observação do Omie, "aberta no Omie" e quando a ficha da OP foi lida.
--  5. movimentos: autor, origem e código de integração do ajuste; RPC upsert_movimentos_ajuste com as colunas
--     novas e sem regravar linha igual (movimentos tem gatilho da outbox do desktop).
--  6. estrutura_produto_cache: local de consumo, autor/data; estrutura_produto_sync (última leitura por produto).

-- 1. Flag por loja -----------------------------------------------------------------------------------------
alter table public.lojas add column if not exists espelho_completo boolean not null default false;
-- Grant por coluna da Fase 0 (migration 109) é uma foto: coluna nova de lojas precisa do próprio grant.
grant select (espelho_completo) on public.lojas to anon, authenticated;
update public.lojas set espelho_completo = true where id = 5 and is_test = false;

-- 2. Estado dos crons --------------------------------------------------------------------------------------
create table if not exists public.espelho_sync_estado (
  loja_id        bigint not null references public.lojas(id) on delete cascade,
  frente         text not null,          -- 'kardex' | 'ajustes' | 'ops-abertas'
  estado         jsonb not null default '{}'::jsonb,
  ultimo_erro    text,
  atualizado_em  timestamptz not null default now(),
  primary key (loja_id, frente)
);
alter table public.espelho_sync_estado enable row level security;
drop policy if exists espelho_sync_estado_select_por_loja on public.espelho_sync_estado;
create policy espelho_sync_estado_select_por_loja on public.espelho_sync_estado for select using (
  (select usuario_e_admin()) or loja_id in (select usuario_lojas())
);
revoke all on public.espelho_sync_estado from anon;
revoke insert, update, delete, truncate on public.espelho_sync_estado from authenticated;
grant select on public.espelho_sync_estado to authenticated;

-- 3. Saldo e custo em qualquer data ------------------------------------------------------------------------
-- Último movimento (não cancelado) até a data, por produto e local, na ordem data_mov, id_mov.
-- Só vale onde o kardex já cobre: a tela usa espelho_sync_estado (frente 'kardex') para dizer "desde dd/mm".
-- security invoker: o usuário logado só enxerga as lojas dele (RLS de kardex_omie).
create index if not exists kardex_omie_saldo_idx
  on public.kardex_omie (loja_id, n_cod_prod, codigo_local_estoque, data_mov desc, id_mov desc);

create or replace function public.saldo_em_data(p_loja_id bigint, p_data date)
returns table (n_cod_prod bigint, codigo_local_estoque bigint, saldo numeric, cmc numeric, data_mov date, id_mov bigint)
language sql stable set search_path = public as $$
  select distinct on (k.n_cod_prod, k.codigo_local_estoque)
         k.n_cod_prod, k.codigo_local_estoque, k.saldo_apos, k.cmc_apos, k.data_mov, k.id_mov
  from kardex_omie k
  where k.loja_id = p_loja_id and k.data_mov <= p_data and not k.cancelado
  order by k.n_cod_prod, k.codigo_local_estoque, k.data_mov desc, k.id_mov desc
$$;
revoke all on function public.saldo_em_data(bigint, date) from public, anon;
grant execute on function public.saldo_em_data(bigint, date) to authenticated;

-- 4. OPs abertas -------------------------------------------------------------------------------------------
alter table public.ordens_producao add column if not exists origem_op            text;        -- cupom | manual | script | app | vendas
alter table public.ordens_producao add column if not exists incluido_por_omie    text;        -- outrasInf.uInc
alter table public.ordens_producao add column if not exists obs_omie             text;        -- observacoes.cObs (a coluna observacao é do app)
alter table public.ordens_producao add column if not exists aberta_omie          boolean;     -- true = veio na lista de abertas do Omie; false = não veio
alter table public.ordens_producao add column if not exists itens_consultados_em timestamptz; -- ConsultarOrdemProducao já lido (ficha gravada na OP)
create index if not exists idx_op_loja_produto on public.ordens_producao (loja_id, identificacao_n_cod_produto, id desc);

-- 5. Ajustes com autor ---------------------------------------------------------------------------------------
alter table public.movimentos add column if not exists autor          text;  -- "NTB Estoque · Nome" / "Usuário:Nome" na obs
alter table public.movimentos add column if not exists origem_ajuste  text;  -- app | script | pdv | api | omie (tela)
alter table public.movimentos add column if not exists cod_int_ajuste text;  -- ITEMnnnn / MOV-n = app; FPI-/SEED-/CORTE- = script

-- Mesmo INSERT ... ON CONFLICT da 079 (índice único PARCIAL: .upsert() do supabase-js não serve), agora com as
-- 3 colunas novas e só regravando quando algo mudou (o cron relê janelas de data e não pode encher a outbox).
-- Linha criada pelo PRÓPRIO APP (movimentação manual/transferência: cod_int_ajuste 'MOV-<id da linha>' ou
-- transferencia_id preenchido) só recebe autor/origem/código: quan assinado (SAI negativa), data com hora da Bahia,
-- motivo e obs digitados pelo usuário nunca são sobrescritos pelo que o Omie devolve.
create or replace function public.upsert_movimentos_ajuste(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update movimentos m set
    autor = x.autor, origem_ajuste = x.origem_ajuste, cod_int_ajuste = x.cod_int_ajuste, updated_at = now()
  from (
    select (r->>'loja_id')::bigint as loja_id, (r->>'id_ajuste')::bigint as id_ajuste,
           r->>'autor' as autor, r->>'origem_ajuste' as origem_ajuste, r->>'cod_int_ajuste' as cod_int_ajuste
    from jsonb_array_elements(p_rows) as r
  ) x
  where m.loja_id = x.loja_id and m.id_ajuste = x.id_ajuste
    and (m.transferencia_id is not null or x.cod_int_ajuste = 'MOV-' || m.id)
    and (m.autor, m.origem_ajuste, m.cod_int_ajuste) is distinct from (x.autor, x.origem_ajuste, x.cod_int_ajuste);

  insert into movimentos (
    loja_id, id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque,
    codigo_local_estoque_destino, data, motivo, obs, origem, status, autor, origem_ajuste, cod_int_ajuste
  )
  select
    (r->>'loja_id')::bigint,
    (r->>'id_ajuste')::bigint,
    (r->>'id_prod')::bigint,
    r->>'tipo',
    (r->>'quan')::numeric,
    (r->>'valor')::numeric,
    (r->>'codigo_local_estoque')::bigint,
    (r->>'codigo_local_estoque_destino')::bigint,
    (r->>'data')::timestamptz,
    r->>'motivo',
    r->>'obs',
    r->>'origem',
    r->>'status',
    r->>'autor',
    r->>'origem_ajuste',
    r->>'cod_int_ajuste'
  from jsonb_array_elements(p_rows) as r
  on conflict (loja_id, id_ajuste) where id_ajuste is not null do update set
    id_prod = excluded.id_prod,
    tipo = excluded.tipo,
    quan = excluded.quan,
    valor = excluded.valor,
    codigo_local_estoque = excluded.codigo_local_estoque,
    codigo_local_estoque_destino = excluded.codigo_local_estoque_destino,
    data = excluded.data,
    motivo = excluded.motivo,
    obs = excluded.obs,
    origem = excluded.origem,
    status = excluded.status,
    autor = excluded.autor,
    origem_ajuste = excluded.origem_ajuste,
    cod_int_ajuste = excluded.cod_int_ajuste,
    updated_at = now()
  where movimentos.transferencia_id is null
    and excluded.cod_int_ajuste is distinct from 'MOV-' || movimentos.id
    and (movimentos.id_prod, movimentos.tipo, movimentos.quan, movimentos.valor, movimentos.codigo_local_estoque,
         movimentos.codigo_local_estoque_destino, movimentos.data, movimentos.motivo, movimentos.obs, movimentos.origem,
         movimentos.status, movimentos.autor, movimentos.origem_ajuste, movimentos.cod_int_ajuste)
    is distinct from
        (excluded.id_prod, excluded.tipo, excluded.quan, excluded.valor, excluded.codigo_local_estoque,
         excluded.codigo_local_estoque_destino, excluded.data, excluded.motivo, excluded.obs, excluded.origem,
         excluded.status, excluded.autor, excluded.origem_ajuste, excluded.cod_int_ajuste);
end;
$$;

-- 6. Fichas automáticas ----------------------------------------------------------------------------------------
alter table public.estrutura_produto_cache add column if not exists id_malha             bigint;
alter table public.estrutura_produto_cache add column if not exists codigo_local_estoque bigint;  -- local de consumo do insumo
alter table public.estrutura_produto_cache add column if not exists local_fonte          text;    -- 'ficha' | 'op' (última OP do produto)
alter table public.estrutura_produto_cache add column if not exists incluido_por         text;    -- uIncProdMalha
alter table public.estrutura_produto_cache add column if not exists incluido_em          date;    -- dIncProdMalha
alter table public.estrutura_produto_cache add column if not exists alterado_por         text;    -- uAltProdMalha
alter table public.estrutura_produto_cache add column if not exists alterado_em          date;    -- dAltProdMalha

-- Última leitura da ficha de cada produto (inclusive "sem ficha"): o cron refaz a cada 7 dias.
create table if not exists public.estrutura_produto_sync (
  loja_id          bigint not null references public.lojas(id) on delete cascade,
  codigo_produto   bigint not null,
  sincronizado_em  timestamptz not null default now(),
  itens            integer not null default 0,
  primary key (loja_id, codigo_produto)
);
alter table public.estrutura_produto_sync enable row level security;
drop policy if exists estrutura_produto_sync_select_por_loja on public.estrutura_produto_sync;
create policy estrutura_produto_sync_select_por_loja on public.estrutura_produto_sync for select using (
  (select usuario_e_admin()) or loja_id in (select usuario_lojas())
);
revoke all on public.estrutura_produto_sync from anon;
revoke insert, update, delete, truncate on public.estrutura_produto_sync from authenticated;
grant select on public.estrutura_produto_sync to authenticated;
