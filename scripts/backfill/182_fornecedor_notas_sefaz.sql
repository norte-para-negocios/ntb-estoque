-- Carga das notas antigas da SEFAZ/XML sem fornecedor (Task 14, depois da migration 182). ESCREVE EM DADO DE PRODUÇÃO:
-- rodar só com OK do dono, depois do backup. Só lojas de estoque próprio. Conferir antes e depois:
--   select count(*) filter (where n_id_fornecedor is null) as sem_fornecedor, count(*) from notas_fiscais
--    where origem = 'sefaz' and c_cnpj_cpf is not null and loja_id in (select id from lojas where modo_estoque = 'proprio');
update notas_fiscais nf
   set n_id_fornecedor = fornecedor_da_nota_sefaz(nf.loja_id, nf.c_cnpj_cpf, nf.c_razao_social, nf.c_nome, nf.c_inscricao),
       updated_at = now()
 where nf.origem = 'sefaz' and nf.n_id_fornecedor is null and nf.c_cnpj_cpf is not null and nf.deleted_at is null
   and nf.loja_id in (select id from lojas where modo_estoque = 'proprio' and not is_test);
