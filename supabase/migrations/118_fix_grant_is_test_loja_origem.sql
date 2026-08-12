-- Fix de emergência (2026-08-12): a migration 109 (Fase 0) concedeu
-- SELECT em `lojas` só nas colunas que existiam NAQUELE momento --
-- column-level GRANT no Postgres é um snapshot fixo, não reativo a
-- colunas novas (o comentário original da 109 sugeria "automático",
-- mas isso só se aplica se o bloco DO $$ for reexecutado). As colunas
-- `is_test`/`loja_origem_id` (criadas hoje na migration 117) nunca
-- ganharam esse grant -- qualquer query de `authenticated`/`anon` que
-- toque essas colunas (inclusive só em WHERE, como
-- `app/(app)/layout.tsx`/`getAtorGestao()` fazem com `.eq('is_test',
-- false)`) falha com "permission denied for table lojas". Achado
-- durante QA desta mesma sessão, antes de qualquer usuário real ser
-- afetado (deploy da 117 só aconteceu nesta mesma rodada).

grant select (is_test, loja_origem_id) on lojas to anon, authenticated;
