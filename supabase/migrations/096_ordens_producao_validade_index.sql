-- home/page.tsx filtra ordens_producao por loja_id + validade (nao nula,
-- range) + condicao de saldo -- sem indice cobrindo validade, a query fazia
-- scan caro demais: medido 3.1s pra devolver so 21 linhas (loja 3,
-- 2026-07-30). Indice parcial cobre a parte cara (achar as linhas com
-- validade no intervalo certo); o filtro de saldo (OR complexo) fica pra
-- depois, sobre um conjunto ja pequeno.
create index if not exists idx_op_validade_loja
  on ordens_producao(loja_id, validade)
  where validade is not null;
