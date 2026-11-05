-- Teste da 330 (estorno não muda o último custo). Roda dentro de BEGIN ... ROLLBACK, depois da migration.
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99330, '00000000099330', 'TESTE 330', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99330, 8000000033001, 'Geral', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99330, 8000000033101, '80001', 'Feijão', 'KG', '01');

do $$
declare r jsonb; u numeric; c numeric; L bigint := 8000000033001; P bigint := 8000000033101;
begin
  perform registrar_movimento(99330, L, P, 'ENT', 'TESTE', 'e1', 10, 8);
  perform registrar_movimento(99330, L, P, 'ENT', 'TESTE', 'e2', 5, 11);
  select ultimo_custo, cmc into u, c from estoque_custos where loja_id = 99330 and codigo_produto = P;
  assert u = 11 and c = 9, format('após as compras: ultimo %s cmc %s', u, c);

  -- saída de inventário e o estorno dela (refazer a contagem)
  r := registrar_movimento(99330, L, P, 'AJU', 'INVENTARIO', 'inv:1:r1', -0.5, null);
  perform estornar_movimento((r ->> 'id')::bigint, null, 'refeito');
  select ultimo_custo, cmc into u, c from estoque_custos where loja_id = 99330 and codigo_produto = P;
  assert u = 11, format('estorno de ajuste mudou o último custo para %s', u);
  assert c = 9, format('cmc mudou para %s', c);

  -- estorno de venda também não
  r := registrar_movimento(99330, L, P, 'SAI', 'VENDA', 'v1', 2, null);
  perform estornar_movimento((r ->> 'id')::bigint, null, null);
  select ultimo_custo into u from estoque_custos where loja_id = 99330 and codigo_produto = P;
  assert u = 11, format('estorno de venda mudou o último custo para %s', u);

  -- entrada comum com custo continua mudando
  perform registrar_movimento(99330, L, P, 'ENT', 'TESTE', 'e3', 1, 12);
  select ultimo_custo into u from estoque_custos where loja_id = 99330 and codigo_produto = P;
  assert u = 12, format('entrada comum não atualizou o último custo: %s', u);
  raise notice '330 OK';
end $$;
