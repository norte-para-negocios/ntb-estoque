-- Previsao de venda por produto: saidas de estoque no mesmo periodo do ano anterior
-- (ListarMovimentos do Omie, nQtdeSaidas agregado). Base, junto do estoque minimo
-- e do saldo atual, para a sugestao de compra:  compra = minimo + previsao - atual.

create table if not exists previsao_venda (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  n_cod_prod bigint not null,
  qtde numeric(20,6) not null default 0,
  periodo_ini date,
  periodo_fim date,
  updated_at timestamptz not null default now(),
  unique(loja_id, n_cod_prod)
);

create index if not exists idx_previsao_venda_loja_prod on previsao_venda(loja_id, n_cod_prod);
