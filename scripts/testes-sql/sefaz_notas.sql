-- Teste da migration 139 (notas da SEFAZ em loja de estoque próprio). Roda dentro de BEGIN ... ROLLBACK.
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99030, '00000000099030', 'TESTE SEFAZ', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99030, 8000000003901, 'Geral', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, ean) values
  (99030, 8000000003801, '80001', 'Limão', 'KG', '01', null), (99030, 8000000003802, '90001', 'Heineken', 'UN', '00', '7891234567895');

do $$
declare r jsonb; v_nota bigint; v_idr text; v_comp bigint; n int; s text; et text; fo jsonb; v_saldo numeric;
  chave text := '29260742200741000166550010001714561002445643';
begin
  -- 1) resumo (resNFe): cria a nota sem itens, origem sefaz, situação 'resumo'
  r := gravar_nota_sefaz(99030, jsonb_build_object('chave', chave, 'numero', '171456', 'serie', '1', 'modelo', '55', 'emissao', '2026-10-05',
        'valor', 100.00, 'fornecedor_nome', 'FORNECEDOR TESTE', 'fornecedor_cnpj', '42200741000166', 'ambiente', '1',
        'full_object', jsonb_build_object('sefaz', jsonb_build_object('completo', false, 'alertas', '[]'::jsonb), 'infoCadastro', jsonb_build_object('cRecebido', 'N'))), '[]'::jsonb);
  assert (r->>'criada')::boolean, 'resumo cria ' || r;
  v_nota := (r->>'nota_id')::bigint; v_idr := r->>'n_id_receb';
  assert v_idr::bigint >= 8000000000001, 'n_id_receb da sequência própria';
  assert (select origem from notas_fiscais where id = v_nota) = 'sefaz', 'origem sefaz';
  assert sincronizar_situacao_nota(99030, v_nota) = 'resumo', 'situacao resumo';

  -- 2) XML completo chega depois: MESMO registro (idempotência pela chave), agora com itens
  r := gravar_nota_sefaz(99030, jsonb_build_object('chave', chave, 'numero', '171456', 'valor', 100.00, 'fornecedor_nome', 'FORNECEDOR TESTE',
        'full_object', jsonb_build_object('sefaz', jsonb_build_object('completo', true), 'cabec', jsonb_build_object('cCNPJ_CPF', '42200741000166'))),
        jsonb_build_array(
          jsonb_build_object('seq', 1, 'c_prod', 'LIM01', 'descricao', 'LIMAO TAHITI KG', 'ncm', '08055000', 'cfop', '5102', 'qtde', 10, 'unidade', 'KG', 'preco_unit', 6, 'total', 60),
          jsonb_build_object('seq', 2, 'c_prod', 'HEI330', 'descricao', 'CERVEJA HEINEKEN 330ML', 'ean', '7891234567895', 'cfop', '5102', 'qtde', 20, 'unidade', 'UN', 'preco_unit', 2, 'total', 40)));
  assert not (r->>'criada')::boolean and (r->>'nota_id')::bigint = v_nota and r->>'n_id_receb' = v_idr, 'mesma nota ' || r;
  assert (select count(*) from notas_fiscais where loja_id = 99030) = 1, 'sem duplicar nota';
  assert (select count(*) from nota_fiscal_items where nota_fiscal_id = v_nota) = 2, 'itens gravados';
  -- reimportar não duplica itens
  perform gravar_nota_sefaz(99030, jsonb_build_object('chave', chave, 'valor', 100.00), jsonb_build_array(
          jsonb_build_object('seq', 1, 'c_prod', 'LIM01', 'descricao', 'LIMAO TAHITI KG', 'qtde', 10, 'unidade', 'KG', 'preco_unit', 6, 'total', 60)));
  assert (select count(*) from nota_fiscal_items where nota_fiscal_id = v_nota) = 2, 'reimportar não duplica itens';

  -- 3) compra para conferência: item 2 casa por EAN (sugestão), item 1 fica pendente
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', 99030, 'chave_acesso', chave, 'nota_fiscal_id', v_nota, 'numero', '171456',
        'fornecedor_cnpj', '42.200.741/0001-66', 'fornecedor_nome', 'FORNECEDOR TESTE', 'emissao', '2026-10-05', 'valor_frete', 0, 'valor_desconto', 0,
        'itens', jsonb_build_array(
          jsonb_build_object('linha', 1, 'c_prod', 'LIM01', 'descricao', 'LIMAO TAHITI KG', 'unidade_compra', 'KG', 'quantidade', 10, 'valor_unitario', 6, 'valor_total', 60, 'sugestao_codigo_produto', 8000000003801, 'match_origem', 'descricao', 'match_score', 0.6),
          jsonb_build_object('linha', 2, 'c_prod', 'HEI330', 'ean', '7891234567895', 'descricao', 'CERVEJA HEINEKEN 330ML', 'unidade_compra', 'UN', 'quantidade', 20, 'valor_unitario', 2, 'valor_total', 40, 'codigo_produto', 8000000003802, 'match_origem', 'ean', 'match_score', 1))),
        8000000003901);
  assert (r->>'criada')::boolean, 'compra criada';
  v_comp := (r->>'compra_id')::bigint;
  assert (select count(*) from estoque_movimentos where loja_id = 99030) = 0, 'registrar não lança no estoque';
  assert sincronizar_situacao_nota(99030, v_nota) = 'a_conferir', 'a conferir';
  assert (select c_etapa from notas_fiscais where id = v_nota) = '40', 'etapa 40 pendente';
  -- registrar de novo é idempotente
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', 99030, 'chave_acesso', chave, 'itens', '[]'::jsonb), 8000000003901);
  assert not (r->>'criada')::boolean and (select count(*) from compras_proprio where loja_id = 99030) = 1, 'compra não duplica';

  -- 4) vincula o item pendente (aprende o de-para) e lança tudo
  perform vincular_item_compra(99030, (select id from compras_proprio_itens where compra_id = v_comp and linha = 1), 8000000003801, 1, 'teste');
  assert (select count(*) from fornecedor_produto_depara where loja_id = 99030 and fornecedor_cnpj = '42200741000166') = 1, 'depara aprendido';
  assert (select n_id_produto from nota_fiscal_items where nota_fiscal_id = v_nota and n_sequencia = 1) = 8000000003801, 'item da nota espelha o produto';
  r := lancar_compra(jsonb_build_object('loja_id', 99030, 'id', v_comp, 'itens', '[]'::jsonb), 8000000003901, 'teste');
  assert r->>'status' = 'lancada' and (r->>'lancados')::int = 2, 'lançou os 2 itens ' || r;
  select saldo into v_saldo from estoque_saldos where loja_id = 99030 and codigo_produto = 8000000003802;
  assert v_saldo = 20, 'saldo heineken';
  assert sincronizar_situacao_nota(99030, v_nota) = 'lancada', 'situação lançada';
  select c_etapa, full_object into et, fo from notas_fiscais where id = v_nota;
  assert et = '60' and fo->'infoCadastro'->>'cRecebido' = 'S' and fo->'sefaz'->>'situacao' = 'lancada', 'nota concluída ' || fo::text;
  -- lançar de novo não duplica entrada
  r := lancar_compra(jsonb_build_object('loja_id', 99030, 'id', v_comp, 'itens', '[]'::jsonb), 8000000003901, 'teste');
  select saldo into v_saldo from estoque_saldos where loja_id = 99030 and codigo_produto = 8000000003802;
  assert v_saldo = 20, 'sem entrada dupla';

  -- 5) estorno volta a nota para pendente
  perform estornar_compra(v_comp, 'teste');
  assert sincronizar_situacao_nota(99030, v_nota) = 'estornada', 'estornada';
  assert (select c_etapa from notas_fiscais where id = v_nota) = '40', 'volta pendente';

  -- 6) evento de cancelamento da SEFAZ marca a nota
  r := sefaz_marcar_cancelada(99030, chave);
  assert (select full_object->'infoCadastro'->>'cCancelada' from notas_fiscais where id = v_nota) = 'S', 'marcada cancelada';

  -- 7) loja omie recusa
  begin perform gravar_nota_sefaz(2, '{"chave":"x"}'::jsonb); assert false, 'omie recusa';
  exception when sqlstate '22023' then null; end;

  -- 8) controle de NSU
  insert into sefaz_nsu (loja_id, cnpj) values (99030, '00000000099030');
  assert (select ult_nsu from sefaz_nsu where loja_id = 99030) = '0' and (select ambiente from sefaz_nsu where loja_id = 99030) = 1, 'nsu padrão';
  insert into sefaz_documentos (loja_id, nsu, tipo, chave) values (99030, '000000000000001', 'resNFe', chave);
  begin insert into sefaz_documentos (loja_id, nsu, tipo, chave) values (99030, '000000000000001', 'resNFe', chave); assert false, 'nsu único';
  exception when unique_violation then null; end;
  raise notice 'SEFAZ NOTAS OK';
end $$;
