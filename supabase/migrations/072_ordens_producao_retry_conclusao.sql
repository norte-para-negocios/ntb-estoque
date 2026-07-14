-- Rastreamento de tentativas de conclusao que falharam no Omie, pra permitir
-- reenvio automatico (cron) e manual, sem repetir OPs que ninguem tentou concluir
-- ainda. "Pendente de reenvio" = concluida=false AND conclusao_status IS NOT NULL.
alter table ordens_producao
  add column if not exists conclusao_status text,              -- null | 'Erro' | 'Sem CMC'
  add column if not exists conclusao_erro_msg text,
  add column if not exists conclusao_qtde_desejada numeric(20,6),
  add column if not exists conclusao_data_desejada date,
  add column if not exists conclusao_tentativas integer not null default 0,
  add column if not exists conclusao_ultima_tentativa_em timestamptz;

create index if not exists idx_op_retry_pendente
  on ordens_producao(loja_id, concluida, conclusao_status)
  where concluida = false and conclusao_status is not null;
