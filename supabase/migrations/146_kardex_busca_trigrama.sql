-- 146 — Busca livre do kardex (Movimentações em loja de estoque próprio) com índice de trigrama.
-- A função kardex_proprio (137) filtra com `ilike '%texto%'` em referência, observação, usuário,
-- transferência e na descrição/código do produto. Sem índice isso vira varredura completa quando o
-- ledger passa de centenas de milhares de linhas. Aditiva: só extensão + índices (nada muda de resultado).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 146_kardex_busca_trigrama.sql

create extension if not exists pg_trgm with schema extensions;

create index if not exists estoque_movimentos_ref_trgm  on public.estoque_movimentos using gin (ref extensions.gin_trgm_ops);
create index if not exists estoque_movimentos_obs_trgm  on public.estoque_movimentos using gin (obs extensions.gin_trgm_ops);
create index if not exists estoque_movimentos_user_trgm on public.estoque_movimentos using gin (user_id extensions.gin_trgm_ops);
create index if not exists estoque_movimentos_trf_trgm  on public.estoque_movimentos using gin (transferencia_ref extensions.gin_trgm_ops);
create index if not exists produtos_descricao_trgm      on public.produtos using gin (descricao extensions.gin_trgm_ops);
create index if not exists produtos_codigo_trgm         on public.produtos using gin (codigo extensions.gin_trgm_ops);
