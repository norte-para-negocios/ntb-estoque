-- Alarga as colunas de VALOR que recebem dados crus do Omie de numeric(10,2)
-- (teto R$ 99.999.999,99) para numeric(20,6), igual ao que a migration 026 já fez
-- com as colunas de QUANTIDADE. Sem isso, um valor fora da faixa fazia o Postgres
-- rejeitar o upsert e — como o código não checava o erro — a nota fiscal / produto
-- sumia em silêncio. Widening é seguro (sem perda de dado, sem lock relevante).

alter table notas_fiscais     alter column n_valor_nfe   type numeric(20,6);
alter table nota_fiscal_items alter column n_preco_unit  type numeric(20,6);
alter table produtos          alter column valor_unitario type numeric(20,6);
