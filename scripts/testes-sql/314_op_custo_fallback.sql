-- Teste da migration 314 (OP/receita com insumo sem custo usa o último custo conhecido). CÓPIA local, nunca produção.
-- Precisa da 311 e da 312. Tudo dentro de BEGIN … ROLLBACK:
--   begin; \i …/311 \i …/312 \i supabase/migrations/314_op_custo_fallback.sql \i scripts/testes-sql/314_op_custo_fallback.sql rollback;
-- Espera: NOTICE "314 OP CUSTO FALLBACK OK".
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99314, '00000000099314', 'TESTE 314', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99314, 8000000031401, 'Cozinha', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99314, 8000000031411, '31411', 'Azeite 314', 'L', '00'),
  (99314, 8000000031412, '31412', 'Sal 314', 'KG', '00'),
  (99314, 8000000031413, '31413', 'Cebola 314', 'KG', '00'),
  (99314, 8000000031414, '31414', 'Moqueca 314', 'UN', '04');

do $$
declare L bigint := 8000000031401; AZ bigint := 8000000031411; SAL bigint := 8000000031412; CEB bigint := 8000000031413;
        MOQ bigint := 8000000031414; v_f bigint; r jsonb; e record; v_ordem bigint;
begin
  insert into fichas_tecnicas (loja_id, codigo_produto, versao, rendimento) values (99314, MOQ, 1, 1) returning id into v_f;
  insert into ficha_tecnica_itens (ficha_id, loja_id, codigo_insumo, quantidade_liquida, ordem) values
    (v_f, 99314, AZ, 0.5, 1), (v_f, 99314, SAL, 0.1, 2), (v_f, 99314, CEB, 0.2, 3);
  -- azeite: custo médio zerado mas último custo conhecido R$ 6 (ex.: estoque inicial sem custo depois de uma compra)
  insert into estoque_custos (loja_id, codigo_produto, cmc, ultimo_custo, saldo_total) values (99314, AZ, 0, 6, 0);
  -- sal: nenhum custo; cebola: custo normal R$ 4
  perform registrar_movimento(99314, L, CEB, 'ENT', 'COMPRA', 'c1', 10, 4.00);

  -- 1) produzir: azeite sai a R$ 6 (estimado), sal a 0 (estimado), cebola a 4
  r := produzir(99314, MOQ, 2, L, L, 'op-314', null, null);
  v_ordem := (r->>'ordem_id')::bigint;
  -- 2 × (0,5 × 6 + 0,1 × 0 + 0,2 × 4) = 2 × 3,8 = 7,6 → 3,8 por moqueca
  assert (r->>'custo_total')::numeric = 7.6 and (r->>'custo_unitario')::numeric = 3.8, 'custo da OP com o último custo: ' || r::text;
  select * into e from estoque_movimentos_efetivo where loja_id = 99314 and codigo_produto = AZ and ref = 'op-314';
  assert e.custo_unitario = 6 and e.custo_estimado and e.revisado, 'consumo do azeite estimado pelo último custo: ' || row_to_json(e)::text;
  assert e.custo_original = 0, 'o ledger continua com 0';
  assert e.motivo_revisao like '%último custo%', 'motivo diz de onde veio';
  select * into e from estoque_movimentos_efetivo where loja_id = 99314 and codigo_produto = SAL and ref = 'op-314';
  assert e.custo_unitario = 0 and e.custo_estimado, 'sal sem custo nenhum: 0 e estimado';
  select * into e from estoque_movimentos_efetivo where loja_id = 99314 and codigo_produto = CEB and ref = 'op-314';
  assert e.custo_unitario = 4 and not e.custo_estimado and not e.revisado, 'cebola com custo: sem revisão';
  assert (select custo_unitario from ordens_producao_proprio_itens where ordem_id = v_ordem and codigo_insumo = AZ) = 6, 'item da OP com o custo usado';
  select * into e from estoque_movimentos_efetivo where loja_id = 99314 and codigo_produto = MOQ and ref = 'op-314';
  assert e.custo_unitario = 3.8 and e.custo_estimado, 'entrada do prato com custo, estimada (insumo estimado)';
  assert (select cmc from estoque_custos where loja_id = 99314 and codigo_produto = AZ) = 0, 'saída não muda o CMC do insumo';
  -- repetir a mesma OP não grava nada de novo
  r := produzir(99314, MOQ, 2, L, L, 'op-314', null, null);
  assert (r->>'duplicado')::boolean, 'OP repetida é duplicada';
  assert (select count(*) from estoque_mov_revisao rv join estoque_movimentos m on m.id = rv.movimento_id where m.loja_id = 99314) = 3,
    'só as 3 revisões (azeite, sal e a entrada do prato)';

  -- 2) consumo_por_receita (venda que baixa pela receita): mesma regra
  r := consumo_por_receita(99314, MOQ, 1, L, 'ped-1', null, 0, 'VENDA');
  select * into e from estoque_movimentos_efetivo where loja_id = 99314 and codigo_produto = AZ and origem = 'VENDA';
  assert e.custo_unitario = 6 and e.custo_estimado, 'venda pela receita usa o último custo: ' || row_to_json(e)::text;

  -- 3) quando a nota do azeite chega (com data anterior), o reprocessamento troca o estimado pelo custo real
  perform registrar_movimento(99314, L, AZ, 'ENT', 'COMPRA', 'c2', 5, 8.00, null, null, 0, null, null, (now() at time zone 'America/Sao_Paulo')::date - 1);
  r := reprocessar_custo(99314, array[AZ], (now() at time zone 'America/Sao_Paulo')::date - 1, 'nota do azeite');
  select * into e from estoque_movimentos_efetivo where loja_id = 99314 and codigo_produto = AZ and ref = 'op-314';
  assert e.custo_unitario = 8 and not e.custo_estimado, 'consumo passa ao custo real: ' || row_to_json(e)::text;
  select * into e from estoque_movimentos_efetivo where loja_id = 99314 and codigo_produto = MOQ and ref = 'op-314';
  -- (0,5 × 8 + 0 + 0,2 × 4) = 4,8 por moqueca
  assert e.custo_unitario = 4.8, 'prato recalculado em cascata: ' || e.custo_unitario;
  assert e.custo_estimado, 'sal continua sem custo: prato segue estimado';
  raise notice '314 OP CUSTO FALLBACK OK';
end $$;
