-- Teste da migration 176 (Compras com valor de estoque e sem itens que não movimentam estoque). Cópia local com o
-- esquema de produção (pg_dump --schema-only de lojas/notas_fiscais/nota_fiscal_items/produtos) + 097 + 175 (+ 176).
-- Nunca em produção.
do $$
declare v_loja bigint; v_nf bigint; r record; s numeric; n int;
begin
  insert into lojas (nome, cnpj) values ('TESTE 176', '00000000000000') returning id into v_loja;
  insert into notas_fiscais (loja_id, c_etapa, c_numero_nfe, d_emissao_nfe, c_razao_social, full_object)
    values (v_loja, '60', '000004063', '2026-10-13', 'FORNECEDOR TESTE', '{"infoCadastro":{"cCancelada":"N"}}') returning id into v_nf;
  insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_produto, c_codigo_produto, c_descricao_produto, n_qtde_nfe, n_preco_unit, full_object) values
    (v_loja, v_nf, 1, '80104', 'PESCADA', 77, 41.7, '{"itensCabec":{"vTotalItem":3197.93,"vDesconto":12.97},"itensCustoEstoque":{"cIPICusto":"S","cICMSSTCusto":"S"},"itensAjustes":{"cCFOPEntrada":"1.102"}}'),
    (v_loja, v_nf, 2, '60034', 'ESPONJA', 1, 6.5, '{"itensCabec":{"vTotalItem":6.5},"itensICMS":{"nValor":1.33},"itensCustoEstoque":{"cICMSCusto":"N"},"itensAjustes":{"cCFOPEntrada":"1.102"}}'),
    (v_loja, v_nf, 3, '99999', 'NAO MOVIMENTA', 10, 10, '{"itensCabec":{"vTotalItem":100},"itensAjustes":{"cNaoGerarMovEstoque":"S","cCFOPEntrada":"1.102"}}');

  select * into r from relatorio_compras_total(v_loja, '2026-10-01', '2026-10-31');
  if r.valor <> 3217.40 then raise exception 'total valor: % (esperado 3217.40)', r.valor; end if;
  if r.valor_estoque <> 3203.10 then raise exception 'total valor_estoque: % (esperado 3203.10)', r.valor_estoque; end if;
  if r.n_notas <> 1 then raise exception 'n_notas: %', r.n_notas; end if;

  select count(*), sum(valor_estoque) into n, s from relatorio_compras_matriz(v_loja, '2026-10-01', '2026-10-31', 'produto');
  if n <> 2 or s <> 3203.10 then raise exception 'matriz: % linhas, soma %', n, s; end if;

  select count(*), sum(valor_estoque) into n, s from relatorio_compras_dim(v_loja, '2026-10-01', '2026-10-31', 'produto');
  if n <> 2 or s <> 3203.10 then raise exception 'dim: % linhas, soma %', n, s; end if;

  select count(*), sum(valor_estoque) into n, s from relatorio_compras_detalhe(v_loja, '2026-10-01', '2026-10-31');
  if n <> 2 or s <> 3203.10 then raise exception 'detalhe: % linhas, soma %', n, s; end if;

  raise notice 'relatorio_compras (176) OK';
  delete from lojas where id = v_loja;
end $$;
