-- Sertão Teste (2026-08-12) — ver docs/superpowers/specs/
-- 2026-08-12-sertao-teste-integracao-isolada-design.md (repo NTB
-- Vendas). Ordem de Produção de teste, totalmente isolada da tabela
-- real (ordens_producao) e da Omie -- nenhum relatório/tela existente
-- deve ler esta tabela.

create table if not exists ordens_producao_teste (
  id bigint generated always as identity primary key,
  loja_id bigint not null references lojas(id),
  codigo_produto bigint,
  codigo_produto_texto text not null,
  quantidade numeric not null,
  pedido_ref text,
  criado_em timestamptz not null default now()
);

-- Chave de API SEPARADA de lojas.integracao_api_key (migration 061) --
-- nunca deve ser confundida/reusada com a chave real de nenhuma loja.
-- Nullable: só a loja Sertão terá valor.
alter table lojas add column if not exists integracao_teste_api_key text unique;
