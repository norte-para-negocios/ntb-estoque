-- Historico de movimentacoes de estoque (entradas/saidas por produto/dia),
-- importado do Omie via ListarMovimentos (v1/estoque/movestoque).
-- Backfill 2026 carregado por scripts/backfill-movimentos.mjs (82k linhas, ~12 MB).
-- Idempotente por (loja_id, cod_prod, data).
create table if not exists movimentos_historico (
  loja_id    int    not null,
  cod_prod   bigint not null,
  codigo     text,
  descricao  text,
  data       date   not null,
  entradas   numeric default 0,
  saidas     numeric default 0,
  primary key (loja_id, cod_prod, data)
);

-- Consulta tipica: por loja + periodo, e por produto.
create index if not exists idx_movhist_loja_data on movimentos_historico (loja_id, data);
create index if not exists idx_movhist_loja_prod on movimentos_historico (loja_id, cod_prod);
