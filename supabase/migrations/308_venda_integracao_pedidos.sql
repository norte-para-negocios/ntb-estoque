-- 308 — Registro de cada pedido de baixa que o Norte Vendas manda para /api/integracao/ordem-producao (02/11/2026).
-- Por quê: quando o Vendas desiste de esperar (timeout de 150 s) a baixa fica "incerta" lá (341 só no Sertão em 30 dias)
-- e ninguém confere. Com este registro, GET /api/integracao/ordem-producao/status?pedidoRef= responde se o pedido
-- chegou, se terminou e o resultado de cada item — e o Vendas resolve sozinho sem reenviar o que já foi baixado.
-- A rota grava a linha ANTES de qualquer escrita no Omie/estoque (recebido_em) e completa no fim (concluido_em +
-- resultados). Linha sem concluido_em = em andamento ou interrompida: o Vendas mantém "incerto".
-- Escrita/leitura só pelo service_role. Aditiva: aplicar ANTES do deploy do código (sem a tabela a rota segue sem
-- registrar e a consulta responde 503).
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 308_venda_integracao_pedidos.sql

create table if not exists public.venda_integracao_pedidos (
  id bigserial primary key,
  loja_id bigint not null references public.lojas(id) on delete cascade,
  pedido_ref text not null,                        -- id do pedido no Norte Vendas, em minúsculas
  itens text[] not null default '{}',              -- códigos enviados, na ordem do corpo
  modo text,                                       -- omie | proprio | nenhum | teste
  recebido_em timestamptz not null default now(),
  concluido_em timestamptz,
  resultados jsonb                                 -- o mesmo array "resultados" devolvido ao Vendas
);
create index if not exists venda_integracao_pedidos_ref_idx on public.venda_integracao_pedidos (loja_id, pedido_ref);
create index if not exists venda_integracao_pedidos_loja_tempo_idx on public.venda_integracao_pedidos (loja_id, recebido_em);

alter table public.venda_integracao_pedidos enable row level security;
revoke all on public.venda_integracao_pedidos from anon, authenticated;
grant all on public.venda_integracao_pedidos to service_role;
grant usage, select on sequence public.venda_integracao_pedidos_id_seq to service_role;

notify pgrst, 'reload schema';
