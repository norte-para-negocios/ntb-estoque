-- Teste de compras_proprio (roda dentro de BEGIN ... ROLLBACK, junto com as migrations 132 e 135).
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99003, '00000000099003', 'TESTE COMPRAS', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99003, 8000000000921, 'Geral', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99003, 8000000000821, '80001', 'Limao', 'KG', '01'),
  (99003, 8000000000822, '90001', 'Cerveja', 'UN', '00'),
  (99003, 8000000000823, '80002', 'Cachaca', 'ML', '01');

do $$
declare r jsonb; c jsonb; s numeric; cm numeric; k text := '12345678901234567890123456789012345678901234'; n int;
begin
  -- compra por XML: 3 itens, 2 mapeados; frete 30 rateado; desconto da nota 0
  c := jsonb_build_object('loja_id', 99003, 'origem', 'xml', 'chave_acesso', k, 'numero', '1234', 'serie', '1',
    'fornecedor_cnpj', '11.222.333/0001-44', 'fornecedor_nome', 'Hortifruti X', 'emissao', '2026-10-06', 'valor_frete', 30,
    'itens', jsonb_build_array(
      jsonb_build_object('linha', 1, 'c_prod', 'L1', 'descricao', 'Limao caixa 20kg', 'unidade_compra', 'CX', 'quantidade', 2, 'valor_unitario', 100, 'valor_total', 200, 'fator', 20, 'codigo_produto', 8000000000821),
      jsonb_build_object('linha', 2, 'c_prod', 'C1', 'descricao', 'Cerveja fardo 12', 'unidade_compra', 'FD', 'quantidade', 1, 'valor_unitario', 100, 'valor_total', 100, 'fator', 12, 'codigo_produto', 8000000000822),
      jsonb_build_object('linha', 3, 'c_prod', 'P1', 'descricao', 'Cachaca 1L', 'unidade_compra', 'L', 'quantidade', 1, 'valor_unitario', 50, 'valor_total', 50, 'fator', 1000)));
  r := lancar_compra(c, 8000000000921, 'tester');
  assert r->>'status' = 'parcial' and (r->>'lancados')::int = 2 and (r->>'pendentes')::int = 1, 'parcial ' || r;
  -- rateio: base líquida 350; frete 30; item1 = 200 + 30*200/350 = 217.142857 / 40 = 5.428571
  select cmc, saldo_total into cm, s from estoque_custos where loja_id = 99003 and codigo_produto = 8000000000821;
  assert s = 40 and cm = 5.428571, 'limao ' || s || ' ' || cm;
  select cmc into cm from estoque_custos where loja_id = 99003 and codigo_produto = 8000000000822;
  assert cm = round((100 + 30.0 * 100 / 350) / 12, 6), 'cerveja ' || cm;
  -- reimportar a MESMA chave não duplica
  r := lancar_compra(c, 8000000000921, 'tester');
  assert (r->>'lancados')::int = 0 and (r->>'ja_lancados')::int = 2 and (r->>'pendentes')::int = 1, 'reimport ' || r;
  select count(*) into n from compras_proprio where loja_id = 99003; assert n = 1, 'uma compra só';
  select saldo_total into s from estoque_custos where loja_id = 99003 and codigo_produto = 8000000000821; assert s = 40, 'saldo não duplicou';
  -- mapeia o item pendente e lança só ele
  r := lancar_compra(jsonb_build_object('loja_id', 99003, 'id', (select id from compras_proprio where loja_id = 99003),
        'itens', jsonb_build_array(jsonb_build_object('linha', 3, 'codigo_produto', 8000000000823, 'fator', 1000))), 8000000000921, 'tester');
  assert r->>'status' = 'lancada' and (r->>'lancados')::int = 1, 'lancou pendente ' || r;
  select saldo_total into s from estoque_custos where loja_id = 99003 and codigo_produto = 8000000000823; assert s = 1000, 'cachaca ml';
  -- de-para aprendido: nova compra do mesmo fornecedor mapeia sozinha
  r := lancar_compra(jsonb_build_object('loja_id', 99003, 'origem', 'manual', 'numero', '77', 'fornecedor_cnpj', '11222333000144',
        'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'c_prod', 'L1', 'quantidade', 1, 'valor_unitario', 120, 'valor_total', 120))), 8000000000921, 'tester');
  assert r->>'status' = 'lancada', 'depara ' || r;
  select saldo_total into s from estoque_custos where loja_id = 99003 and codigo_produto = 8000000000821; assert s = 60, 'depara fator 20';
  -- estorno da compra devolve o saldo e cancela
  r := estornar_compra((select id from compras_proprio where loja_id = 99003 and chave_acesso = k), 'tester');
  assert (r->>'estornados')::int = 3, 'estorno ' || r;
  select saldo_total into s from estoque_custos where loja_id = 99003 and codigo_produto = 8000000000821; assert s = 20, 'saldo após estorno ' || s;
  assert (select status from compras_proprio where chave_acesso = k) = 'cancelada', 'cancelada';
  begin perform lancar_compra(c, 8000000000921, 'tester'); assert false, 'cancelada não relança';
  exception when sqlstate '22023' then null; end;
  -- chave inválida recusada
  begin insert into compras_proprio (loja_id, origem, chave_acesso) values (99003, 'xml', '123'); assert false, 'chave invalida';
  exception when check_violation then null; end;
  -- loja omie recusa
  begin perform lancar_compra(jsonb_build_object('loja_id', 2, 'itens', '[]'::jsonb), 1, 'x'); assert false, 'omie recusa';
  exception when sqlstate '22023' then null; end;
  raise notice 'COMPRAS OK';
end $$;
