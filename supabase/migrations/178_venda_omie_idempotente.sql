-- 178: venda do Norte Vendas → Omie sem duplicar quando o pedido é reenviado (Fase A, Tasks 9 e 10; matriz H11).
-- (1) venda_op_vinculo: uma linha por OP de venda (loja + cCodIntOP derivado de pedido + produto + ocorrência,
--     lib/vendas/venda-idempotente.ts). O fluxo lê o vínculo antes de chamar o Omie: já criada → só conclui; já
--     concluída → não chama nada. O estorno acha as OPs por aqui (não depende mais do integration_attempts, podado em
--     2 dias). Escrita só pelo service_role; leitura pela loja (padrão initplan da 156).
-- (2) movimentos.venda_chave: chave única da saída de estoque da venda (VND-…); um reenvio não grava outra saída.
-- Aplicar SEM transação (-1): o índice é criado com concurrently.

create table if not exists venda_op_vinculo (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  pedido_ref text not null,
  codigo_produto bigint not null,
  ocorrencia int not null,
  cod_int_op text not null,
  n_cod_op bigint,
  estado text not null default 'incluindo' check (estado in ('incluindo', 'criada', 'concluida', 'estornada')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (loja_id, cod_int_op)
);
create index if not exists venda_op_vinculo_pedido_idx on venda_op_vinculo (loja_id, pedido_ref);

alter table venda_op_vinculo enable row level security;
drop policy if exists venda_op_vinculo_select on venda_op_vinculo;
create policy venda_op_vinculo_select on venda_op_vinculo for select to authenticated
  using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on venda_op_vinculo from anon, authenticated;
grant select on venda_op_vinculo to authenticated;
grant all on venda_op_vinculo to service_role;
grant usage, select on sequence venda_op_vinculo_id_seq to service_role;

alter table movimentos add column if not exists venda_chave text;
create unique index concurrently if not exists movimentos_venda_chave_uq on movimentos (loja_id, venda_chave) where venda_chave is not null;

notify pgrst, 'reload schema';
