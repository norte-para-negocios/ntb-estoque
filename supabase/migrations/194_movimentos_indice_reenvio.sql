-- 194: índice para os crons de reenvio ao Omie lerem só as linhas pendentes de movimentos (Fase I, 19/10/2026).
-- SEM transação (create index concurrently):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 194_movimentos_indice_reenvio.sql
--
-- Medido em produção (pg_stat_statements, 26/09–19/10): as consultas de elegibilidade de
-- retryMovimentosManuaisPendentes / retryMovimentosTransferenciaPendentes (lib/actions/movimentacoes.ts e
-- transferencia.ts; a cada 10 min, por loja e por status) somam 39.336 + 19.668 + 39.336 + 19.668 chamadas;
-- as duas maiores fazem 106 ms e 96 ms em média (pico 2,4 s) e leem ~11,4 mil blocos cada, porque não há índice
-- por status: varrem todos os movimentos da loja (414 mil linhas, 99,8 % "Concluido") para achar as ~700
-- pendentes (Sem CMC 535, Iniciado 116, Erro 31, Processando 15 em 19/10).
-- Índice comum (não parcial) de propósito: o PostgREST manda o status como parâmetro, e um índice parcial
-- "where status <> 'Concluido'" não serve em plano genérico.
--
-- Reverter: drop index concurrently if exists movimentos_loja_status_tentativa_idx;

create index concurrently if not exists movimentos_loja_status_tentativa_idx
  on public.movimentos (loja_id, status, ultima_tentativa_em nulls first);

analyze public.movimentos;
