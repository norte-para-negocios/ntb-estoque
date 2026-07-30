-- reconciliarOPsFantasmas (lib/omie/ordem-producao.ts) filtra por
-- loja_id + concluida=false + identificacao_d_dt_previsao (range) +
-- identificacao_n_cod_op not null, ordenando por identificacao_d_dt_previsao.
-- Sem indice cobrindo esse padrao, a query dava "canceling statement due to
-- statement timeout" quando as 6 lojas rodavam concorrentes (achado real
-- 2026-07-30, ao investigar por que o backlog de OPs fantasma nunca
-- diminuia) -- e o codigo nao checava erro nessa query, entao o timeout
-- virava silenciosamente "0 candidatas" em vez de um erro visivel.
create index if not exists idx_op_fantasma_candidatas
  on ordens_producao(loja_id, identificacao_d_dt_previsao)
  where concluida = false and identificacao_n_cod_op is not null;
