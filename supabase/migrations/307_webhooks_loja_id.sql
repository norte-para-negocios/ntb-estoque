-- 307 — Financeiro A0: índice (loja_id, id) em webhooks para o cron que processa os avisos Financas.* por loja
-- (`id > cursor da loja order by id`). Sem ele, cada ciclo varre a tabela pela chave primária filtrando a loja
-- (a loja 7 tem 7 avisos financeiros em 190 mil linhas).
--
-- SEM transação (create index concurrently não roda dentro de begin/commit) e SEM -1: não bloqueia os inserts do
-- webhook (rota crítica). Aplicar depois da 306 (manual, OK do dono):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 307_webhooks_loja_id.sql
-- Conferir: \d webhooks  →  "webhooks_loja_id_id" btree (loja_id, id) (se ficar INVALID: drop index concurrently e rodar de novo).
-- Opcional para o código (sem o índice a consulta só fica mais lenta).
set lock_timeout = '3s';
create index concurrently if not exists webhooks_loja_id_id on public.webhooks (loja_id, id);
