-- Teste da migration 400 (consumo teórico × real e variação de preço). Rodar com scripts/testes-sql/400_rodar.sh
-- (BEGIN … ROLLBACK, nada fica gravado). Escreve só na loja 19 "ZZ NORTE ERP LAB", em produtos sem nenhum movimento nem
-- compra (Red Bull 97, H2O 98, Refrigerante 96) e no local Estoque Geral. A ODARA (15) é só lida (tempo da consulta).
do $$
declare
  L constant bigint := 19; LOC constant bigint := 8000000000019; OUTRO constant bigint := 8000000000020;
  A constant bigint := 8000000000097; B constant bigint := 8000000000098; C constant bigint := 8000000000096;
  r jsonb; v_inv1 bigint; v_inv2 bigint; v_inv3 bigint; v_saldo numeric; q0 numeric; q1 numeric; v_mov bigint; v_venda bigint;
  x record; v_base numeric; c1 bigint; c2 bigint; c3 bigint; c4 bigint; t0 timestamptz; v_ms numeric;
begin
  assert (select modo_estoque = 'proprio' and is_test from lojas where id = L), 'loja 19 tem de ser a loja-laboratório própria';
  assert not exists (select 1 from estoque_movimentos where loja_id = L and codigo_produto in (A, B, C)), 'produtos de teste sem movimento';

  -- 0) sem nenhuma contagem: B vende e fica "sem_contagem", só com o teórico; nada de real/desvio inventado
  perform registrar_movimento(L, LOC, B, 'ENT', 'ENTRADA_MANUAL', 't400-b-ent', 10, 1.5, null, 'teste 400');
  perform registrar_movimento(L, LOC, B, 'SAI', 'VENDA', 't400-b-v1', 4, null, null, 'teste 400');

  -- 1) A: contagem inicial (inventário de 02/11), com diferença para haver o ajuste do item
  perform registrar_movimento(L, LOC, A, 'ENT', 'ENTRADA_MANUAL', 't400-a-ini', 5, 2, null, 'teste 400');
  v_saldo := (select saldo from estoque_saldos where loja_id = L and codigo_local_estoque = LOC and codigo_produto = A);
  q0 := v_saldo + 3;
  insert into inventarios (loja_id, codigo_local_estoque, data, status) values (L, LOC, '2026-11-02 15:00+00', 'Finalizado') returning id into v_inv1;
  r := registrar_movimento(L, LOC, A, 'AJU', 'INVENTARIO', 't400-inv1', q0 - v_saldo, null, null, 'Inventário teste 400');
  insert into inventario_items (loja_id, inventario_id, produto_codigo_produto, quan, diferenca, status, id_ajuste, ultima_tentativa_em)
  values (L, v_inv1, A, q0, q0 - v_saldo, 'Concluido', (r->>'id')::bigint, clock_timestamp());
  -- B: uma contagem só (continua sem_contagem)
  insert into inventario_items (loja_id, inventario_id, produto_codigo_produto, quan, diferenca, status, id_ajuste, ultima_tentativa_em)
  values (L, v_inv1, B, 6, 0, 'Concluido', null, clock_timestamp());

  -- 2) movimentos entre as contagens
  perform registrar_movimento(L, LOC, A, 'ENT', 'COMPRA', 't400-a-nf', 20, 2, null, 'teste 400');            -- entrada +20
  perform registrar_movimento(L, LOC, A, 'SAI', 'VENDA', 't400-a-v1', 12, null, null, 'teste 400');          -- teórico venda 12
  r := registrar_movimento(L, LOC, A, 'SAI', 'VENDA', 't400-a-v2', 1, null, null, 'teste 400');              -- venda estornada
  perform estornar_movimento((r->>'id')::bigint, null, 'teste 400');
  perform registrar_movimento(L, LOC, A, 'PRD', 'PRODUCAO', 't400-a-op', -3, null, null, 'teste 400');       -- consumo de OP 3
  perform registrar_movimento(L, LOC, A, 'SAI', 'PERDA', 't400-a-perda', 1, null, null, 'quebra teste 400'); -- perda 1
  perform registrar_movimento(L, LOC, A, 'TRF', 'TRANSFERENCIA', 't400-a-trf', -2, null, null, 'teste 400', 0, null, 't400-trf');
  perform registrar_movimento(L, OUTRO, A, 'TRF', 'TRANSFERENCIA', 't400-a-trf', 2, null, null, 'teste 400', 0, null, 't400-trf');
  perform registrar_movimento(L, OUTRO, A, 'SAI', 'VENDA', 't400-a-v3', 2, null, null, 'teste 400');        -- outro local: não conta

  -- contagem do meio (cíclica, 10/11): achou 1 a mais; vira ajuste de inventário e não entra nas "entradas"
  v_saldo := (select saldo from estoque_saldos where loja_id = L and codigo_local_estoque = LOC and codigo_produto = A);
  insert into inventarios (loja_id, codigo_local_estoque, data, status) values (L, LOC, '2026-11-10 15:00+00', 'Finalizado') returning id into v_inv2;
  r := registrar_movimento(L, LOC, A, 'AJU', 'INVENTARIO', 't400-inv2', 1, null, null, 'Inventário teste 400');
  insert into inventario_items (loja_id, inventario_id, produto_codigo_produto, quan, diferenca, status, id_ajuste, ultima_tentativa_em)
  values (L, v_inv2, A, v_saldo + 1, 1, 'Concluido', (r->>'id')::bigint, clock_timestamp());

  -- 3) contagem final (20/11): faltam 2 sem explicação
  v_saldo := (select saldo from estoque_saldos where loja_id = L and codigo_local_estoque = LOC and codigo_produto = A);
  q1 := v_saldo - 2;
  insert into inventarios (loja_id, codigo_local_estoque, data, status) values (L, LOC, '2026-11-20 15:00+00', 'Finalizado') returning id into v_inv3;
  r := registrar_movimento(L, LOC, A, 'AJU', 'INVENTARIO', 't400-inv3', -2, null, null, 'Inventário teste 400');
  insert into inventario_items (loja_id, inventario_id, produto_codigo_produto, quan, diferenca, status, id_ajuste, ultima_tentativa_em)
  values (L, v_inv3, A, q1, -2, 'Concluido', (r->>'id')::bigint, clock_timestamp());
  -- item ainda não enviado (sem 'Concluido') não é contagem
  insert into inventario_items (loja_id, inventario_id, produto_codigo_produto, quan, status) values (L, v_inv3, B, 99, 'Pendente');
  -- movimento DEPOIS da contagem final não entra na janela
  perform registrar_movimento(L, LOC, A, 'SAI', 'VENDA', 't400-a-v4', 1, null, null, 'teste 400');

  select * into x from consumo_teorico_real(L, '2026-11-01', '2026-11-30', LOC) t where t.codigo_produto = A;
  assert x.situacao = 'ok', 'A com duas contagens: ok';
  assert x.contagens = 3, format('A: 3 contagens no período (veio %s)', x.contagens);
  assert x.inventario_ini = v_inv1 and x.inventario_fim = v_inv3, 'A: janela da 1ª à última contagem';
  assert x.saldo_ini = q0 and x.saldo_fim = q1, format('A: saldos contados %s/%s (veio %s/%s)', q0, q1, x.saldo_ini, x.saldo_fim);
  assert x.entradas = 18, format('A: entradas = compra 20 − transferência 2 (veio %s)', x.entradas);
  assert x.teorico_venda = 12, format('A: venda estornada e venda de outro local fora (veio %s)', x.teorico_venda);
  assert x.teorico_op = 3 and x.teorico = 15, format('A: teórico 12 + 3 (veio %s/%s)', x.teorico_op, x.teorico);
  assert x.ajustes_perdas = 1, format('A: perda lançada 1 (veio %s)', x.ajustes_perdas);
  -- físico: começou q0, entraram 18, terminou q1 = q0 + 1 → saiu 17; teórico 15 → desvio 2 (1 perda + 2 sumiço − 1 achado)
  assert x.consumo_real = 17, format('A: real = q0 + 18 − q1 = 17 (veio %s)', x.consumo_real);
  assert x.desvio = 2, format('A: desvio 2 (veio %s)', x.desvio);
  assert x.custo_unitario > 0 and x.desvio_valor = round(2 * x.custo_unitario, 2), format('A: desvio em R$ pelo custo efetivo (%s × %s = %s)', x.desvio, x.custo_unitario, x.desvio_valor);
  assert x.teorico_valor = round(15 * x.custo_unitario, 2) and x.real_valor = round(17 * x.custo_unitario, 2), 'A: teórico e real em R$';

  select * into x from consumo_teorico_real(L, '2026-11-01', '2026-11-30', LOC) t where t.codigo_produto = B;
  assert x.situacao = 'sem_contagem' and x.contagens = 1, format('B: uma contagem só = sem_contagem (veio %s/%s)', x.situacao, x.contagens);
  assert x.teorico_venda = 4 and x.consumo_real is null and x.desvio is null and x.desvio_valor is null and x.saldo_ini is null,
    'B: só o teórico, nada inventado';
  -- local de fora do filtro não aparece; sem filtro de local, A aparece no outro local como sem_contagem (venda 2)
  assert not exists (select 1 from consumo_teorico_real(L, '2026-11-01', '2026-11-30', LOC) t where t.codigo_local_estoque <> LOC), 'filtro de local';
  assert (select teorico_venda from consumo_teorico_real(L, '2026-11-01', '2026-11-30', null) t where t.codigo_produto = A and t.codigo_local_estoque = OUTRO) = 2,
    'A no outro local: sem_contagem com a venda de lá';
  -- período 01–09/11: só a contagem de 02/11 → sem_contagem (os movimentos de hoje estão no período)
  assert (select situacao from consumo_teorico_real(L, '2026-11-01', '2026-11-09', LOC) t where t.codigo_produto = A) = 'sem_contagem', 'período com 1 contagem';

  -- 4) variação de preço: C comprado a 2,00 (01/11), depois 2,40 (03/11, +20%), nota pendente 2,50 por un. base (04/11)
  insert into compras_proprio (loja_id, origem, numero, fornecedor_nome, emissao, status) values (L, 'manual', 'T400-1', 'Forn teste', '2026-11-01', 'lancada') returning id into c1;
  insert into compras_proprio_itens (compra_id, loja_id, linha, codigo_produto, quantidade, fator, valor_unitario, valor_total, lancado)
  values (c1, L, 1, C, 10, 1, 2, 20, true);
  insert into compras_proprio (loja_id, origem, numero, fornecedor_nome, emissao, status) values (L, 'manual', 'T400-X', 'Forn teste', '2026-11-02', 'cancelada') returning id into c4;
  insert into compras_proprio_itens (compra_id, loja_id, linha, codigo_produto, quantidade, fator, valor_unitario, valor_total, lancado)
  values (c4, L, 1, C, 1, 1, 50, 50, true);
  insert into compras_proprio (loja_id, origem, numero, fornecedor_nome, emissao, status) values (L, 'manual', 'T400-2', 'Forn teste', '2026-11-03', 'lancada') returning id into c2;
  insert into compras_proprio_itens (compra_id, loja_id, linha, codigo_produto, quantidade, fator, valor_unitario, valor_total, desconto, lancado)
  values (c2, L, 1, C, 5, 1, 2.5, 12.5, 0.5, true);
  insert into compras_proprio (loja_id, origem, numero, fornecedor_nome, emissao, status) values (L, 'manual', 'T400-3', 'Forn teste', '2026-11-04', 'pendente') returning id into c3;
  insert into compras_proprio_itens (compra_id, loja_id, linha, codigo_produto, quantidade, fator, valor_unitario, valor_total, lancado)
  values (c3, L, 1, C, 2, 6, 15, 30, false);

  select * into x from variacao_preco_compras(L, '2026-11-01', '2026-11-30') v where v.compra_id = c2;
  assert x.preco_base = 2.4 and x.preco_anterior = 2 and x.compra_anterior = c1 and x.fonte_anterior = 'compra' and x.variacao_pct = 20,
    format('c2: 2,40 × 2,00 = +20%% pela compra anterior, cancelada fora (veio %s × %s, %s%%, %s)', x.preco_base, x.preco_anterior, x.variacao_pct, x.compra_anterior);
  select * into x from variacao_preco_compras(L, null, null, c3) v;
  assert x.preco_base = 2.5 and x.preco_anterior = 2.4 and x.compra_anterior = c2 and x.variacao_pct = 4.17,
    format('c3 pendente (2 cx × 6): 2,50 × 2,40 = +4,17%% (veio %s × %s, %s%%)', x.preco_base, x.preco_anterior, x.variacao_pct);
  select * into x from variacao_preco_compras(L, '2026-11-01', '2026-11-30') v where v.compra_id = c1;
  assert x.fonte_anterior is null and x.variacao_pct is null, 'c1: 1ª compra, produto sem custo médio → sem comparação';
  assert not exists (select 1 from variacao_preco_compras(L, '2026-11-01', '2026-11-30') v where v.compra_id = c4), 'nota cancelada fora da lista';

  -- 5) configuração por loja: padrão 15%, limite válido
  insert into estoque_config (loja_id) values (L) on conflict (loja_id) do nothing;
  assert (select alerta_variacao_preco_pct from estoque_config where loja_id = L) = 15, 'padrão 15%';
  begin update estoque_config set alerta_variacao_preco_pct = 0 where loja_id = L; raise exception 'aceitou 0%%';
  exception when check_violation then null; end;

  -- 6) permissões: só o servidor (service_role)
  assert not has_function_privilege('authenticated', 'consumo_teorico_real(bigint,date,date,bigint)', 'execute'), 'sem grant authenticated (consumo)';
  assert not has_function_privilege('anon', 'variacao_preco_compras(bigint,date,date,bigint)', 'execute'), 'sem grant anon (preço)';
  assert has_function_privilege('service_role', 'consumo_teorico_real(bigint,date,date,bigint)', 'execute'), 'service_role chama';

  -- 7) tempo na ODARA (só leitura): mês de outubro e 30 dias
  t0 := clock_timestamp();
  perform count(*) from consumo_teorico_real(15, '2026-10-01', '2026-11-05', null);
  v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'consumo_teorico_real ODARA 01/10–05/11: % ms', round(v_ms);
  assert v_ms < 1000, 'consumo na ODARA abaixo de 1 s';
  t0 := clock_timestamp();
  perform count(*) from variacao_preco_compras(15, '2026-10-01', '2026-11-05');
  v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'variacao_preco_compras ODARA 01/10–05/11: % ms', round(v_ms);
  assert v_ms < 1000, 'variação de preço na ODARA abaixo de 1 s';

  raise notice '400 CONSUMO TEORICO REAL OK';
end $$;
