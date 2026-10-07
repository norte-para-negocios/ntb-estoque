-- Teste da migration 145 (lotes e validade). Roda dentro de BEGIN ... ROLLBACK, depois da 145.
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99145, '00000000099145', 'TESTE LOTES', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values
  (99145, 8000000014901, 'Geral', 'S'), (99145, 8000000014902, 'Bar', 'N');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, validade_dias) values
  (99145, 8000000014801, '80001', 'Leite', 'UN', '01', null),
  (99145, 8000000014802, '80002', 'Queijo', 'G', '01', 20),
  (99145, 8000000014803, '70001', 'Molho', 'ML', '03', 3),
  (99145, 8000000014804, '80003', 'Tomate', 'G', '01', null);

do $$
declare
  G bigint := 8000000014901; B bigint := 8000000014902; L bigint := 8000000014801; Q bigint := 8000000014802;
  r jsonb; s numeric; n int; v_l1 bigint; v_l2 bigint; v_mov bigint; v_op bigint; d date;
  function_ok boolean;
begin
  -- 1) entradas: lote L1 (vence em 5 dias), L2 (vence em 2), e uma sem lote
  perform registrar_entrada_lote(99145, G, L, 10, 3.00, 'ENTRADA_MANUAL', 'e1', 'L1', current_date + 5);
  perform registrar_entrada_lote(99145, G, L, 5, 3.00, 'ENTRADA_MANUAL', 'e2', 'L2', current_date + 2);
  perform registrar_movimento(99145, G, L, 'ENT', 'TESTE', 'e3', 3, 3.00);
  select id into v_l1 from estoque_lotes where loja_id=99145 and lote='L1';
  select id into v_l2 from estoque_lotes where loja_id=99145 and lote='L2';
  assert (select saldo from estoque_lotes where id=v_l1) = 10 and (select saldo from estoque_lotes where id=v_l2) = 5, 'entradas com lote';
  assert (select saldo from estoque_lotes where loja_id=99145 and codigo_produto=L and lote is null and validade is null) = 3, 'sem lote';
  -- GUC limpo depois da entrada com lote: entrada seguinte não herda
  assert coalesce(current_setting('estoque.lote', true), '') = '', 'guc limpo';

  -- 2) saída de 6: FEFO tira os 5 do L2 (vence antes) e 1 do L1
  r := registrar_movimento(99145, G, L, 'SAI', 'VENDA', 'v1', 6);
  assert (select saldo from estoque_lotes where id=v_l2) = 0 and (select saldo from estoque_lotes where id=v_l1) = 9, 'FEFO';

  -- 3) saída maior que os lotes: L1 zera, sem lote zera e fica negativo
  r := registrar_movimento(99145, G, L, 'SAI', 'VENDA', 'v2', 20);
  v_mov := (r->>'id')::bigint;
  assert (select saldo from estoque_lotes where id=v_l1) = 0, 'L1 zerou';
  assert (select saldo from estoque_lotes where loja_id=99145 and codigo_produto=L and lote is null and validade is null) = -8, 'sem lote negativo';
  assert (select sum(saldo) from estoque_lotes where loja_id=99145 and codigo_produto=L and codigo_local_estoque=G)
       = (select saldo from estoque_saldos where loja_id=99145 and codigo_produto=L and codigo_local_estoque=G), 'lotes = ledger (negativo)';

  -- 4) estorno da saída: devolve aos MESMOS lotes
  perform estornar_movimento(v_mov);
  assert (select saldo from estoque_lotes where id=v_l1) = 9, 'estorno devolveu ao L1';
  assert (select saldo from estoque_lotes where loja_id=99145 and codigo_produto=L and lote is null and validade is null) = 3, 'estorno devolveu ao sem lote';

  -- 5) transferência de 4 Geral -> Bar: o lote vai junto (L1, mesma validade)
  perform transferir_estoque(99145, G, B, L, 4, 'trf1');
  assert (select saldo from estoque_lotes where id=v_l1) = 5, 'origem perdeu 4 do L1';
  assert (select saldo from estoque_lotes where loja_id=99145 and codigo_local_estoque=B and lote='L1' and validade=current_date+5) = 4, 'destino recebeu o L1';

  -- 6) baixa por vencimento do L1 no Bar: sai exatamente desse lote, origem PERDA
  select id into v_l2 from estoque_lotes where loja_id=99145 and codigo_local_estoque=B and lote='L1';
  r := baixar_lote(99145, v_l2, 3, 'vencido na geladeira', 'venc:teste1', 'tester');
  assert (select saldo from estoque_lotes where id=v_l2) = 1, 'baixa no lote certo';
  assert (select origem from estoque_movimentos where id=(r->>'id')::bigint) = 'PERDA', 'origem PERDA';
  begin perform baixar_lote(99145, v_l2, 50, 'demais', 'venc:teste2'); assert false, 'baixa maior que o saldo'; exception when sqlstate '22023' then null; end;
  begin perform baixar_lote(99145, v_l2, 1, '', 'venc:teste3'); assert false, 'motivo obrigatorio'; exception when sqlstate '22023' then null; end;

  -- 7) compra manual com lote e validade por item (lancar_compra_com_lotes)
  r := lancar_compra_com_lotes(jsonb_build_object('loja_id', 99145, 'origem', 'manual', 'itens', jsonb_build_array(
         jsonb_build_object('linha', 1, 'quantidade', 1000, 'valor_unitario', 0.05, 'valor_total', 50, 'fator', 1, 'codigo_produto', Q, 'lote', 'NF77', 'validade', (current_date + 9)::text),
         jsonb_build_object('linha', 2, 'quantidade', 500, 'valor_unitario', 0.05, 'valor_total', 25, 'fator', 1, 'codigo_produto', Q))), G, 'tester');
  assert (select saldo from estoque_lotes where loja_id=99145 and codigo_produto=Q and lote='NF77' and validade=current_date+9) = 1000, 'compra com lote';
  -- item sem lote/validade usa o prazo padrão do produto (20 dias)
  assert (select saldo from estoque_lotes where loja_id=99145 and codigo_produto=Q and lote is null and validade=current_date+20) = 500, 'compra sem lote usa validade_dias';
  assert (select lote from compras_proprio_itens i join compras_proprio c on c.id=i.compra_id where c.loja_id=99145 and i.linha=1) = 'NF77', 'lote gravado no item';

  -- 8) compra pelo item já gravado (fluxo da SEFAZ: item com lote, depois lancar_compra)
  r := lancar_compra(jsonb_build_object('loja_id', 99145, 'origem', 'xml', 'chave_acesso', '99999999999999999999999999999999999999999145',
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 0, 'valor_unitario', 1, 'valor_total', 1, 'fator', 1))), G, 'tester');
  update compras_proprio_itens set codigo_produto = Q, quantidade = 200, lote = 'XML1', validade = current_date + 4
   where compra_id = (r->>'compra_id')::bigint and linha = 1;
  r := lancar_compra(jsonb_build_object('loja_id', 99145, 'id', (r->>'compra_id')::bigint, 'itens', '[]'::jsonb), G, 'tester');
  assert (select saldo from estoque_lotes where loja_id=99145 and codigo_produto=Q and lote='XML1') = 200, 'lote do item da compra';

  -- 9) produção pela OP: lote = número da OP, validade da OP
  perform registrar_movimento(99145, G, 8000000014804, 'ENT', 'TESTE', 'tom', 5000, 0.01);
  perform salvar_ficha(99145, 8000000014803, 1000, '[{"codigo_insumo":8000000014804,"quantidade_liquida":1000}]'::jsonb);
  r := op_proprio_criar(99145, 8000000014803, current_date, 1000, G, G, current_date + 6, 'teste', 'joao');
  v_op := (r->>'id')::bigint;
  perform op_proprio_concluir(99145, v_op, current_date, 1000, 'joao', null);
  assert (select validade from estoque_lotes where loja_id=99145 and codigo_produto=8000000014803 and saldo > 0) = current_date + 6, 'validade da OP';
  assert (select lote from estoque_lotes where loja_id=99145 and codigo_produto=8000000014803 and saldo > 0) = (r->>'num_op'), 'lote = numero da OP';
  -- reverter a OP devolve o lote
  perform op_proprio_reverter(99145, v_op, 'joao');
  assert coalesce((select sum(saldo) from estoque_lotes where loja_id=99145 and codigo_produto=8000000014803), 0) = 0, 'reversao da OP tira o lote';

  -- 10) OP sem validade usa o prazo do produto (3 dias)
  r := op_proprio_criar(99145, 8000000014803, current_date, 500, G, G, null, 'teste', 'joao');
  perform op_proprio_concluir(99145, (r->>'id')::bigint, current_date, 500, 'joao', null);
  assert (select validade from estoque_lotes where loja_id=99145 and codigo_produto=8000000014803 and saldo > 0) = current_date + 3, 'validade_dias do produto';

  -- 11) invariante: nenhum (local, produto) da loja com lotes diferentes do ledger
  select count(*) into n from estoque_lotes_divergencia where loja_id = 99145;
  assert n = 0, 'divergencias: ' || n;
  assert reconciliar_lotes(99145) = 0, 'nada a reconciliar';

  -- 12) reconciliação corrige divergência manual no "sem lote"
  update estoque_lotes set saldo = saldo + 7 where loja_id=99145 and codigo_produto=L and codigo_local_estoque=G and lote is null and validade is null;
  assert (select count(*) from estoque_lotes_divergencia where loja_id = 99145) = 1, 'divergencia detectada';
  assert reconciliar_lotes(99145) = 1, 'reconciliou';
  assert (select count(*) from estoque_lotes_divergencia where loja_id = 99145) = 0, 'sem divergencia depois';

  raise notice 'VALIDADE LOTES OK';
end $$;
