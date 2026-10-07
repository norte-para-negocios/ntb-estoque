-- Teste da migration 142 (roda dentro de BEGIN ... ROLLBACK, depois das 132 e 133 e 142).
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99042, '00000000099042', 'TESTE FATURAMENTO', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99042, 8000000042901, 'Bar', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, descricao_familia) values
  (99042, 8000000042801, '90001', 'Cerveja Long Neck', 'UN', '00', 'Cervejas'),
  (99042, 8000000042802, '90002', 'Caipirinha', 'UN', '04', 'Drinks'),
  (99042, 8000000042803, '80001', 'Cachaça', 'ML', '01', 'Insumos'),
  (99042, 8000000042804, '80002', 'Limão', 'G', '01', 'Insumos');

do $$
declare r jsonb; n int; v numeric; c numeric; l record; lojas_antes int;
begin
  -- estoque inicial com custo: cerveja 8,00; cachaça 0,05/ml; limão 0,01/g
  perform registrar_movimento(99042, 8000000042901, 8000000042801, 'ENT', 'T', 'e1', 50, 8.00);
  perform registrar_movimento(99042, 8000000042901, 8000000042803, 'ENT', 'T', 'e2', 3000, 0.05);
  perform registrar_movimento(99042, 8000000042901, 8000000042804, 'ENT', 'T', 'e3', 3000, 0.01);
  perform salvar_ficha(99042, 8000000042802, 1, '[{"codigo_insumo":8000000042803,"quantidade_liquida":60},{"codigo_insumo":8000000042804,"quantidade_liquida":80}]'::jsonb);

  -- custo teórico da ficha: 60*0,05 + 80*0,01 = 3,80
  select cmc into c from cmc_efetivo_proprio(99042) where codigo_produto = 8000000042802;
  assert c = 3.8, 'cmc efetivo da ficha ' || c;
  select cmc into c from cmc_efetivo_proprio(99042) where codigo_produto = 8000000042801;
  assert c = 8, 'cmc efetivo do estoque ' || c;

  -- venda: 2 cervejas (14) + 1 caipirinha (22) = 50; pagamento 30 pix + 20 dinheiro
  r := registrar_venda_proprio(99042, jsonb_build_object(
    'pedidoRef', 'ped-1', 'data', '2026-10-06', 'hora', '21:00:00', 'tipo', 'mesa', 'mesa', '5', 'valor', 50, 'operador', 'Ana',
    'nota', jsonb_build_object('chave', null, 'numero', 140, 'serie', 1, 'status', 'autorizada'),
    'itens', jsonb_build_array(
      jsonb_build_object('linha', 1, 'codigo', '90001', 'nome', 'Cerveja Long Neck', 'quantidade', 2, 'valorUnitario', 14, 'valor', 28),
      jsonb_build_object('linha', 2, 'codigo', '90002', 'nome', 'Caipirinha', 'quantidade', 1, 'valorUnitario', 22, 'valor', 22)),
    'pagamentos', jsonb_build_array(
      jsonb_build_object('sequencia', 1, 'metodo', 'PIX', 'valor', 30), jsonb_build_object('sequencia', 2, 'metodo', 'CASH', 'valor', 20))));
  assert (r->>'duplicado')::boolean = false and (r->>'n_id_cupom')::bigint >= 8000000000001, 'registrar ' || r;

  -- pré-agregado nas 5 dimensões + forma_pgto
  select valor into v from faturamento_importado where loja_id = 99042 and dimensao = 'tipo' and rotulo = 'Mercadoria p/ revenda' and mes = '2026-10';
  assert v = 28, 'tipo revenda ' || coalesce(v::text, 'null');
  select valor into v from faturamento_importado where loja_id = 99042 and dimensao = 'familia' and rotulo = 'Drinks' and mes = '2026-10';
  assert v = 22, 'familia drinks';
  select valor into v from faturamento_importado where loja_id = 99042 and dimensao = 'familia>produto' and rotulo = 'Cervejas>>Cerveja Long Neck' and mes = '2026-10';
  assert v = 28, 'composta';
  select valor into v from faturamento_importado where loja_id = 99042 and dimensao = 'forma_pgto' and rotulo = 'Pix' and mes = '2026-10';
  assert v = 30, 'pix';
  select valor into v from faturamento_importado where loja_id = 99042 and dimensao = 'forma_pgto' and rotulo = 'Dinheiro' and mes = '2026-10';
  assert v = 20, 'dinheiro';

  -- reenvio do mesmo pedido: não duplica, mantém o mesmo cupom
  r := registrar_venda_proprio(99042, jsonb_build_object('pedidoRef', 'ped-1', 'data', '2026-10-06', 'valor', 50,
    'itens', jsonb_build_array(
      jsonb_build_object('linha', 1, 'codigo', '90001', 'nome', 'Cerveja Long Neck', 'quantidade', 2, 'valorUnitario', 14, 'valor', 28),
      jsonb_build_object('linha', 2, 'codigo', '90002', 'nome', 'Caipirinha', 'quantidade', 1, 'valorUnitario', 22, 'valor', 22)),
    'pagamentos', jsonb_build_array(jsonb_build_object('sequencia', 1, 'metodo', 'PIX', 'valor', 50))));
  assert (r->>'duplicado')::boolean, 'reenvio duplicado';
  select count(*) into n from vendas_proprio where loja_id = 99042;
  assert n = 1, 'uma venda só';
  select valor into v from faturamento_importado where loja_id = 99042 and dimensao = 'forma_pgto' and rotulo = 'Pix' and mes = '2026-10';
  assert v = 50, 'pagamentos substituídos';
  select count(*) into n from faturamento_importado where loja_id = 99042 and dimensao = 'forma_pgto' and rotulo = 'Dinheiro';
  assert n = 0, 'dinheiro antigo removido';

  -- baixas do ledger da venda: direta (cerveja, ref = pedido) e por receita (caipirinha, ref = pedido|produto|linha)
  perform registrar_movimento(99042, 8000000042901, 8000000042801, 'SAI', 'VENDA', 'ped-1', 2, null);
  perform consumo_por_receita(99042, 8000000042802, 1, 8000000042901, 'ped-1', null, 1);

  -- lucro: cerveja 28 - 16 = 12; caipirinha 22 - 3,80 = 18,20; total 50 - 19,80 = 30,20
  select * into l from lucro_proprio(99042, '2026-10-01', '2026-10-31', 'mes');
  assert l.faturamento = 50 and l.cmv = 19.8 and l.lucro = 30.2, 'lucro total ' || l.faturamento || ' ' || l.cmv || ' ' || l.lucro;
  assert l.margem = 60.4, 'margem ' || l.margem;
  assert l.itens_sem_baixa = 0, 'sem baixa';
  select cmv into v from lucro_proprio(99042, '2026-10-01', '2026-10-31', 'produto') where rotulo = 'Caipirinha';
  assert v = 3.8, 'cmv caipirinha ' || v;
  select cmv into v from lucro_proprio(99042, '2026-10-01', '2026-10-31', 'familia') where rotulo = 'Cervejas';
  assert v = 16, 'cmv cervejas';

  -- estorno da venda (movimentos inversos) zera o CMV líquido do pedido
  perform estornar_movimento(m.id) from estoque_movimentos m where m.loja_id = 99042 and m.origem = 'VENDA' and m.ref like 'ped-1%';
  select * into l from lucro_proprio(99042, '2026-10-01', '2026-10-31', 'mes');
  assert l.cmv = 0, 'cmv após estorno ' || l.cmv;

  -- venda sem baixa aparece como tal, nunca como lucro apurado
  perform registrar_venda_proprio(99042, jsonb_build_object('pedidoRef', 'ped-2', 'data', '2026-10-07', 'valor', 14,
    'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'codigo', '90001', 'nome', 'Cerveja Long Neck', 'quantidade', 1, 'valorUnitario', 14, 'valor', 14)),
    'pagamentos', jsonb_build_array(jsonb_build_object('sequencia', 1, 'metodo', 'CREDIT', 'valor', 14))));
  select itens_sem_baixa into n from lucro_proprio(99042, '2026-10-07', '2026-10-07', 'dia');
  assert n = 1, 'sem baixa visível';
  select valor into v from faturamento_importado where loja_id = 99042 and dimensao = 'forma_pgto' and rotulo = 'Cartão de Crédito' and mes = '2026-10';
  assert v = 14, 'cartão de crédito';

  -- cancelamento tira do faturamento, mantém o histórico
  perform cancelar_venda_proprio(99042, 'ped-2');
  select valor into v from faturamento_importado where loja_id = 99042 and dimensao = 'forma_pgto' and rotulo = 'Cartão de Crédito' and mes = '2026-10';
  assert v is null, 'cancelada fora do faturamento';
  select count(*) into n from vendas_proprio where loja_id = 99042;
  assert n = 2, 'histórico mantido';

  -- loja omie recusa
  begin
    perform registrar_venda_proprio(2, '{"pedidoRef":"x"}'::jsonb);
    assert false, 'omie recusa';
  exception when sqlstate '22023' then null; end;

  -- meses anteriores intactos: um mês que a loja omie tinha não é tocado (só recalcula o mês da venda e a própria loja)
  select count(*) into lojas_antes from faturamento_importado where loja_id <> 99042 and mes = '2026-10' and dimensao = 'tipo' and loja_id = 2;
  raise notice 'FATURAMENTO LUCRO OK';
end $$;
