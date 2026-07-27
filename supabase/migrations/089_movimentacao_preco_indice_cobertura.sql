-- 089_movimentacao_preco_indice_cobertura.sql
-- Achado real (2026-07-27, usuário reportou Movimentação "travada em abril"):
-- relatorio_movimentacao_matriz roda em ~130-300ms com cache quente, mas o
-- role `authenticated` tem statement_timeout=8s (config do próprio Supabase)
-- e a query estoura isso quando o cache está frio -- o app engolia o erro em
-- silêncio e a tela caía só na fatia fria (Contabo), parecendo travada em
-- meses antigos mesmo com dado novo no banco.
--
-- EXPLAIN (buffers) mostrou que o maior consumidor isolado de I/O da query
-- inteira é o Index Scan em nota_fiscal_items dentro da CTE `preco` (10714
-- de 24848 buffer hits, ~43% do total) -- ele usa idx_nfi_loja_nf
-- (loja_id, nota_fiscal_id), que NÃO cobre n_id_produto/n_preco_unit, então
-- cada linha exige buscar a linha inteira (heap fetch) só pra aplicar o
-- filtro `n_id_produto is not null and n_preco_unit > 0`. Um índice parcial
-- e coberto, espelhando exatamente esse WHERE, deixa esse passo index-only.
create index concurrently if not exists idx_nfi_loja_prod_preco_cobertura
  on nota_fiscal_items (loja_id, n_id_produto)
  include (n_preco_unit, nota_fiscal_id)
  where n_id_produto is not null and n_preco_unit > 0;
