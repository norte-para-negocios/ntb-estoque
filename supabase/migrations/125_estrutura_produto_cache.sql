-- Cache de ficha técnica (estrutura/malha) de produtos acabados, pra lojas
-- REAIS (não confundir com ficha_tecnica_local, migration 121, que é só
-- pras 6 lojas de teste e propositalmente isolada de relatórios reais).
-- Populada por app/api/sync/estrutura-produto/route.ts, leitura pausada do
-- Omie (ConsultarEstrutura) -- nunca escreve na malha do cliente.
-- Consumida por lib/baixa-op.ts pra valorizar consumo de Ordem de Produção.

create table if not exists estrutura_produto_cache (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  codigo_produto_insumo bigint not null,
  descricao_insumo text,
  quantidade numeric(20,6) not null,
  percentual_perda numeric(6,2) not null default 0,
  unidade varchar(10),
  tipo_insumo varchar(2),
  sincronizado_em timestamptz not null default now(),
  unique(loja_id, codigo_produto, codigo_produto_insumo)
);

create index if not exists idx_estrutura_produto_cache_loja_produto
  on estrutura_produto_cache(loja_id, codigo_produto);
