-- Teste da migration 177: item de nota "não movimenta estoque" fora de movimentacoes_loja. Cópia local, nunca em produção.
do $$
declare v_loja bigint; v_nf bigint; n int;
begin
  insert into lojas (nome, cnpj) values ('TESTE 177', '00000000000000') returning id into v_loja;
  insert into notas_fiscais (loja_id, c_etapa, c_numero_nfe, d_emissao_nfe, c_razao_social, full_object)
    values (v_loja, '60', '000004063', '2026-10-13', 'FORNECEDOR TESTE', '{"infoCadastro":{"cCancelada":"N"}}') returning id into v_nf;
  insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_produto, n_qtde_nfe, n_preco_unit, full_object) values
    (v_loja, v_nf, 101, 77, 41.7, '{"itensAjustes":{"codigo_local_estoque":"1"}}'),
    (v_loja, v_nf, 102, 10, 10, '{"itensAjustes":{"cNaoGerarMovEstoque":"S","codigo_local_estoque":"1"}}');
  select count(*) into n from movimentacoes_loja(v_loja, '2026-10-01', '2026-10-31') where origem = 'nf';
  delete from lojas where id = v_loja;
  if n <> 1 then raise exception 'movimentacoes_loja nf: % linhas (esperado 1)', n; end if;
  raise notice 'movimentacoes_loja (177) OK';
end $$;
