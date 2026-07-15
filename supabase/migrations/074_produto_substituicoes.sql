-- 074_produto_substituicoes.sql
-- Mapeamento manual "produto sem historico usa a previsao de outro produto"
-- (ex: Heineken descontinuado, substituido por Spaten -- Spaten nao tem
-- historico proprio ainda, entao usa o historico do Heineken). 1:1 por loja.
-- Puramente local (igual categorias_contabeis, migration 069): sem RLS,
-- controle de acesso feito na camada de aplicacao via requirePermissao +
-- createServiceClient() nas server actions.

create table if not exists produto_substituicoes (
  id bigint generated always as identity primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  n_cod_prod bigint not null,
  substitui_n_cod_prod bigint not null,
  created_at timestamptz not null default now(),
  unique (loja_id, n_cod_prod)
);

create index if not exists produto_substituicoes_loja_idx on produto_substituicoes(loja_id);

insert into permissoes (nome) values
  ('Produto Substituicoes'),
  ('Produto Substituicoes - Criar'),
  ('Produto Substituicoes - Excluir')
on conflict (nome) do nothing;
