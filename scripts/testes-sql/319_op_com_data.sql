-- Teste da migration 319 (OP com a data da produção). Tudo dentro de BEGIN … ROLLBACK, loja fictícia 99319:
--   begin; \i supabase/migrations/319_op_com_data.sql \i scripts/testes-sql/319_op_com_data.sql rollback;
-- Espera: NOTICE "319 OP COM DATA OK".
set local lock_timeout = '3s';
insert into lojas (id, cnpj, nome, ativo, modo_estoque, is_test) values (99319, '00000000099319', 'TESTE 319', true, 'proprio', true);
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99319, 8000000031901, 'Cozinha', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99319, 8000000031911, '31911', 'Camarão 319', 'KG', '00'),
  (99319, 8000000031912, '31912', 'Molho 319 (pré-preparo)', 'KG', '04');

do $$
declare L bigint := 8000000031901; CAM bigint := 8000000031911; MOL bigint := 8000000031912;
        v_f bigint; r jsonb; e record; v_venda bigint; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_ok boolean;
begin
  insert into fichas_tecnicas (loja_id, codigo_produto, versao, rendimento) values (99319, MOL, 1, 1) returning id into v_f;
  insert into ficha_tecnica_itens (ficha_id, loja_id, codigo_insumo, quantidade_liquida, ordem) values (v_f, 99319, CAM, 1, 1);

  -- camarão entra em 05/10 a R$ 2; o molho é vendido em 20/10 sem ter sido produzido (sai sem custo)
  perform registrar_movimento(99319, L, CAM, 'ENT', 'COMPRA', 'c1', 10, 2.00, null, null, 0, null, null, '2026-10-05');
  r := registrar_movimento(99319, L, MOL, 'SAI', 'VENDA', 'v1', 2, null, null, null, 0, null, null, '2026-10-20');
  v_venda := (r->>'id')::bigint;
  select * into e from estoque_movimentos_efetivo where id = v_venda;
  assert coalesce(e.custo_unitario, 0) = 0, 'antes da OP a venda sai sem custo: ' || coalesce(e.custo_unitario, -1);

  -- 1) OP lançada hoje com a data de 15/10: consumo e entrada em 15/10, e a venda de 20/10 ganha o custo
  r := produzir(99319, MOL, 5, L, L, 'op-319', null, null, '2026-10-15');
  assert (r->>'data_producao') = '2026-10-15', 'data da produção no retorno: ' || r::text;
  assert r->'reprocessamento' is not null and r->'reprocessamento' <> 'null'::jsonb, 'reprocessou: ' || r::text;
  assert (select count(*) from estoque_movimentos where loja_id = 99319 and ref = 'op-319' and data_ref = '2026-10-15') = 2,
    'consumo e entrada gravados em 15/10';
  select * into e from estoque_movimentos_efetivo where id = v_venda;
  assert e.custo_unitario = 2 and e.revisado, 'a venda de 20/10 ganha o custo da OP: ' || row_to_json(e)::text;
  assert (select saldo_total from estoque_custos where loja_id = 99319 and codigo_produto = MOL) = 3, 'saldo do molho 5 - 2';
  assert (select saldo_total from estoque_custos where loja_id = 99319 and codigo_produto = CAM) = 5, 'saldo do camarão 10 - 5';

  -- repetir a mesma OP não grava nada
  r := produzir(99319, MOL, 5, L, L, 'op-319', null, null, '2026-10-15');
  assert (r->>'duplicado')::boolean, 'OP repetida é duplicada';

  -- 2) data no futuro: erro, nada gravado
  v_ok := false;
  begin
    perform produzir(99319, MOL, 1, L, L, 'op-319-fut', null, null, v_hoje + 1);
  exception when sqlstate '22023' then v_ok := sqlerrm like '%futuro%';
  end;
  assert v_ok, 'data no futuro recusada';

  -- 3) antes do 1º movimento da loja: erro
  v_ok := false;
  begin
    perform produzir(99319, MOL, 1, L, L, 'op-319-antes', null, null, '2026-10-01');
  exception when sqlstate '22023' then v_ok := sqlerrm like '%começa em%';
  end;
  assert v_ok, 'data antes do início do estoque recusada';

  -- 4) mês fechado: erro
  insert into estoque_periodo_fechado (loja_id, mes) values (99319, '2026-10-01');
  v_ok := false;
  begin
    perform produzir(99319, MOL, 1, L, L, 'op-319-fech', null, null, '2026-10-25');
  exception when sqlstate '22023' then v_ok := sqlerrm like '%fechado%';
  end;
  assert v_ok, 'mês fechado recusado';
  delete from estoque_periodo_fechado where loja_id = 99319;

  -- 5) sem data = hoje, sem reprocessamento (igual a antes)
  r := produzir(99319, MOL, 1, L, L, 'op-319-hoje', null, null);
  assert (r->>'data_producao')::date = v_hoje and (r->'reprocessamento' is null or r->'reprocessamento' = 'null'::jsonb), 'sem data = hoje: ' || r::text;
  assert (select count(*) from estoque_movimentos where loja_id = 99319 and ref = 'op-319-hoje' and data_ref = v_hoje) = 2, 'gravado hoje';

  -- 6) tela de OP: op_proprio_concluir com a data escolhida grava o estoque naquele dia
  insert into ordens_producao (loja_id, identificacao_n_cod_op, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde,
                               identificacao_codigo_local_estoque, concluida)
  values (99319, -99319, 'OP319', MOL, 2, L, false) returning id into v_f;
  r := op_proprio_concluir(99319, v_f, '2026-10-18', null, null, null);
  assert (select count(*) from estoque_movimentos m join ordens_producao o on o.producao_ref = m.ref
           where o.id = v_f and m.data_ref = '2026-10-18') = 2, 'OP da tela gravada na data escolhida: ' || r::text;
  assert (select dt_conclusao_real from ordens_producao where id = v_f) = '2026-10-18', 'data de conclusão gravada';

  -- 7) entrada manual com data: camarão a R$ 4 em 12/10 refaz o custo do consumo da OP de 15/10 e da venda de 20/10
  r := entrada_manual_com_data(99319, L, CAM, 10, 4, 'em-319', null, 'sem nota', '2026-10-12');
  assert (r->>'data') = '2026-10-12' and r->'reprocessamento' <> 'null'::jsonb, 'entrada com data: ' || r::text;
  -- CMC em 15/10: (10×2 + 10×4)/20 = 3 → consumo da OP a 3, molho a 3, venda de 20/10 a 3
  select * into e from estoque_movimentos_efetivo where id = v_venda;
  assert e.custo_unitario = 3, 'venda refeita pela entrada manual: ' || row_to_json(e)::text;
  v_ok := false;
  begin
    perform entrada_manual_com_data(99319, L, CAM, 1, 4, 'em-319-fut', null, null, v_hoje + 3);
  exception when sqlstate '22023' then v_ok := true;
  end;
  assert v_ok, 'entrada no futuro recusada';

  raise notice '319 OP COM DATA OK';
end $$;
