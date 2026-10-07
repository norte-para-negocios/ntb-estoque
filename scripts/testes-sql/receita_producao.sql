-- Teste da Fase 2 (fichas, produção, consumo por receita). Roda dentro de BEGIN ... ROLLBACK.
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99010, '00000000099010', 'TESTE RECEITA', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values
  (99010, 8000000001901, 'Geral', 'S'), (99010, 8000000001902, 'Cozinha', 'N');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99010, 8000000001801, '90001', 'Moqueca', 'UN', '04'),
  (99010, 8000000001802, '80001', 'Peixe', 'G', '01'),
  (99010, 8000000001803, '80002', 'Leite de coco', 'ML', '01'),
  (99010, 8000000001804, '70001', 'Molho base', 'ML', '03'),
  (99010, 8000000001805, '80003', 'Tomate', 'G', '01');

do $$
declare r jsonb; n int; s numeric; c numeric; v_ok boolean; v_ficha bigint;
begin
  -- estoque inicial (compra): peixe 10000 g a 0,04; coco 5000 ml a 0,01; tomate 3000 g a 0,008
  perform registrar_movimento(99010, 8000000001902, 8000000001802, 'ENT', 'T', 'i1', 10000, 0.04);
  perform registrar_movimento(99010, 8000000001902, 8000000001803, 'ENT', 'T', 'i2', 5000, 0.01);
  perform registrar_movimento(99010, 8000000001902, 8000000001805, 'ENT', 'T', 'i3', 3000, 0.008);

  -- ficha do molho (rende 1000 ml): 600 g tomate liquido com FC 1,25 e 5% perda
  r := salvar_ficha(99010, 8000000001804, 1000, '[{"codigo_insumo":8000000001805,"quantidade_liquida":600,"fator_correcao":1.25,"perda_pct":5}]'::jsonb, false, 'u', 'v1');
  assert (r->>'versao')::int = 1, 'versao 1';
  select quantidade_bruta into c from ficha_tecnica_itens where ficha_id = (r->>'ficha_id')::bigint;
  assert c = 787.5, 'bruta = 600*1.25*1.05 = 787.5, veio ' || c;

  -- ficha da moqueca (rende 1 un): 300 g peixe, 200 ml coco, 100 ml molho (sub-receita, SEM expandir: consome o molho do estoque)
  r := salvar_ficha(99010, 8000000001801, 1, '[
     {"codigo_insumo":8000000001802,"quantidade_liquida":300,"fator_correcao":1},
     {"codigo_insumo":8000000001803,"quantidade_liquida":200},
     {"codigo_insumo":8000000001804,"quantidade_liquida":100}]'::jsonb);
  v_ficha := (r->>'ficha_id')::bigint;

  -- produzir 2000 ml de molho: consome 1575 g de tomate; custo = 1575*0,008/2000 = 0,0063
  r := produzir(99010, 8000000001804, 2000, 8000000001902, 8000000001902, 'op1', 'u');
  assert (r->>'duplicado')::boolean = false and (r->>'custo_unitario')::numeric = 0.0063, 'custo do intermediario ' || r;
  select saldo into s from estoque_saldos where loja_id=99010 and codigo_produto=8000000001805;
  assert s = 3000 - 1575, 'tomate consumido ' || s;
  select saldo into s from estoque_saldos where loja_id=99010 and codigo_produto=8000000001804;
  assert s = 2000, 'molho entregue';
  select cmc into c from estoque_custos where loja_id=99010 and codigo_produto=8000000001804;
  assert c = 0.0063, 'cmc do molho ' || c;
  -- idempotente
  r := produzir(99010, 8000000001804, 2000, 8000000001902, 8000000001902, 'op1', 'u');
  assert (r->>'duplicado')::boolean, 'op idempotente';
  select saldo into s from estoque_saldos where loja_id=99010 and codigo_produto=8000000001805;
  assert s = 1425, 'nao consumiu 2x';

  -- venda de 2 moquecas: baixa peixe 600, coco 400, molho 200 (consumo por receita)
  r := consumo_por_receita(99010, 8000000001801, 2, 8000000001902, 'ped1', 'u', 0);
  assert (r->>'tem_receita')::boolean and jsonb_array_length(r->'itens') = 3, 'consumo tem 3 insumos ' || r;
  select saldo into s from estoque_saldos where loja_id=99010 and codigo_produto=8000000001802;
  assert s = 9400, 'peixe ' || s;
  select saldo into s from estoque_saldos where loja_id=99010 and codigo_produto=8000000001804;
  assert s = 1800, 'molho ' || s;
  select count(*) into n from estoque_receita_consumos where ficha_id = v_ficha;
  assert n = 3, 'rastro da ficha/versao nos 3 movimentos';
  -- idempotencia da venda
  r := consumo_por_receita(99010, 8000000001801, 2, 8000000001902, 'ped1', 'u', 0);
  select saldo into s from estoque_saldos where loja_id=99010 and codigo_produto=8000000001802;
  assert s = 9400, 'venda nao baixa 2x';
  -- duas moquecas no MESMO pedido com linhas diferentes baixam as duas (nao colidem)
  perform consumo_por_receita(99010, 8000000001801, 1, 8000000001902, 'ped1', 'u', 1);
  select saldo into s from estoque_saldos where loja_id=99010 and codigo_produto=8000000001802;
  assert s = 9100, 'linha_base distinta baixa de novo ' || s;
  -- produto sem receita: nada gravado
  r := consumo_por_receita(99010, 8000000001802, 1, 8000000001902, 'ped2', 'u', 0);
  assert not (r->>'tem_receita')::boolean, 'sem receita';

  -- estorno por origem VENDA/ref (como o Vendas faz): ref comeca com o pedido
  select count(*) into n from estoque_movimentos where loja_id=99010 and origem='VENDA' and (ref = 'ped1' or ref like 'ped1|%');
  assert n = 6, 'movimentos do pedido achados pelo like ' || n;

  -- expandir_na_venda: molho vira expandido ate o tomate
  r := salvar_ficha(99010, 8000000001804, 1000, '[{"codigo_insumo":8000000001805,"quantidade_liquida":600,"fator_correcao":1.25,"perda_pct":5}]'::jsonb, true);
  assert (r->>'versao')::int = 2, 'versao 2';
  select count(*) into n from fichas_tecnicas where loja_id=99010 and codigo_produto=8000000001804 and ativa;
  assert n = 1, 'so uma ativa';
  select count(*) into n from expandir_receita(99010, 8000000001801, 1);
  assert n = 3, 'moqueca expande para peixe, coco, tomate';
  select quantidade into s from expandir_receita(99010, 8000000001801, 1) where codigo_insumo = 8000000001805;
  assert s = 78.75, 'tomate para 100 ml de molho = 78.75, veio ' || s;
  c := custo_unitario_ficha(99010, 8000000001801);
  assert c = round(300*0.04 + 200*0.01 + 78.75*0.008, 6), 'custo ao vivo da moqueca ' || c;

  -- ciclo recusado: molho usando moqueca
  begin
    perform salvar_ficha(99010, 8000000001804, 1000, '[{"codigo_insumo":8000000001801,"quantidade_liquida":1}]'::jsonb);
    assert false, 'ciclo deveria falhar';
  exception when check_violation then null; end;
  begin
    perform salvar_ficha(99010, 8000000001801, 1, '[{"codigo_insumo":8000000001801,"quantidade_liquida":1}]'::jsonb);
    assert false, 'auto-referencia deveria falhar';
  exception when check_violation then null; end;

  -- itens imutaveis
  begin
    update ficha_tecnica_itens set quantidade_liquida = 1 where ficha_id = v_ficha;
    assert false, 'update de item deveria falhar';
  exception when sqlstate '55000' then null; end;

  -- loja omie recusa
  begin
    perform produzir(2, 1, 1, 1, 1, 'x');
    assert false, 'omie recusa';
  exception when sqlstate '22023' then null; end;
  raise notice 'RECEITA OK';
end $$;
