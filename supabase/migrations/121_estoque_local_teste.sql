-- Estoque local independente da Omie, só pras lojas de teste
-- (is_test=true, migration 117). Ver docs/superpowers/specs/
-- 2026-08-18-estoque-independente-omie-lojas-teste-design.md.
-- Zero relação com ordens_producao/movimentos/posicao_estoques reais
-- de propósito -- nenhum relatório/tela existente deve ler estas 3
-- tabelas.

create table if not exists ficha_tecnica_local (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  codigo_produto_insumo bigint not null,
  descricao_insumo text,
  quantidade numeric(20,6) not null,
  percentual_perda numeric(6,2) not null default 0,
  unidade varchar(10),
  sincronizado_em timestamptz not null default now(),
  unique(loja_id, codigo_produto, codigo_produto_insumo)
);

create table if not exists estoque_local_saldos (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  saldo numeric(20,6) not null default 0,
  atualizado_em timestamptz not null default now(),
  unique(loja_id, codigo_produto)
);

create table if not exists movimentos_locais (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  tipo varchar(3) not null check (tipo in ('SAI','ENT')),
  quantidade numeric(20,6) not null,
  saldo_apos numeric(20,6) not null,
  origem_n_cod_op bigint,
  pedido_ref text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_movimentos_locais_loja_produto
  on movimentos_locais(loja_id, codigo_produto, criado_em desc);
