-- Teste da migration 317 (registrar_movimento com reset sem custo conhecido + leitores no custo efetivo). CÓPIA local,
-- nunca produção. Precisa de 311–314; a 317 é aplicada NO MEIO deste arquivo (\i) para comparar antes × depois.
-- Rodar da raiz do repositório:
--   begin; \i …/311 \i …/312 \i …/313 \i …/314 \i scripts/testes-sql/317_leitores_custo_efetivo.sql rollback;
-- Espera: NOTICE "317 LEITORES CUSTO EFETIVO OK".
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99318, '00000000099318', 'TESTE 317', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99318, 8000000031801, 'Estoque', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99318, 8000000031811, '31811', 'Coca 317', 'UN', '00'),
  (99318, 8000000031812, '31812', 'Peixe 317', 'KG', '00'),
  (99318, 8000000031813, '31813', 'Moqueca 317', 'UN', '04');

create temp table t317_ids (op bigint) on commit drop;
do $$
declare L bigint := 8000000031801; COCA bigint := 8000000031811; PEI bigint := 8000000031812; MOQ bigint := 8000000031813;
        v_f bigint; v_op bigint; d date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into fichas_tecnicas (loja_id, codigo_produto, versao, rendimento) values (99318, MOQ, 1, 1) returning id into v_f;
  insert into ficha_tecnica_itens (ficha_id, loja_id, codigo_insumo, quantidade_liquida, ordem) values (v_f, 99318, PEI, 0.5, 1);
  insert into ordens_producao (loja_id, ficha_id, identificacao_n_cod_produto) values (99318, v_f, MOQ) returning id into v_op;
  insert into t317_ids values (v_op);
  -- tudo nos últimos dias (a curva ABC olha created_at dos últimos 90 dias), sem par de estorno, custos > 0
  perform registrar_movimento(99318, L, COCA, 'ENT', 'COMPRA', 'c1', 20, 4.00, null, null, 0, null, null, d - 5);
  perform registrar_movimento(99318, L, COCA, 'SAI', 'VENDA', 'v1', 3, null, null, null, 0, null, null, d - 4);
  perform registrar_movimento(99318, L, PEI, 'ENT', 'COMPRA', 'c2', 10, 30.00, null, null, 0, null, null, d - 5);
  perform produzir(99318, MOQ, 2, L, L, 'OP:' || v_op || ':1', null, null);
  perform registrar_movimento(99318, L, MOQ, 'SAI', 'VENDA', 'v2', 1, null, null, null, 0, null, null, d);
  -- nota lançada com data antiga (ainda sem reprocessar): entra fora de ordem
  perform registrar_movimento(99318, L, COCA, 'ENT', 'COMPRA', 'c3', 10, 5.00, null, null, 0, null, null, d - 6);
end $$;

-- ANTES da 317 (definições de produção)
create temp table t317_antes on commit drop as
select 'curva' as k, to_jsonb(x) as v from curva_abc(99318, 90) x
union all select 'movval', to_jsonb(x) from relatorio_movimentacao_valor_mov(99318, current_date - 30, current_date) x
union all select 'op', op_proprio_detalhe(99318, (select op from t317_ids))
union all select 'sug', sugestao_compra_proprio(99318, current_date - 30, current_date, current_date, current_date + 15)
union all select 'pos', to_jsonb(x) from posicao_proprio_em_data(99318, current_date) x;

\i supabase/migrations/317_custo_efetivo_leitores.sql

do $$
declare n int; d date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb; j jsonb;
        L bigint := 8000000031801; COCA bigint := 8000000031811;
begin
  -- 1) sem revisão: todos os leitores devolvem o mesmo
  create temp table t317_depois on commit drop as
  select 'curva' as k, to_jsonb(x) as v from curva_abc(99318, 90) x
  union all select 'movval', to_jsonb(x) from relatorio_movimentacao_valor_mov(99318, current_date - 30, current_date) x
  union all select 'op', op_proprio_detalhe(99318, (select op from t317_ids))
  union all select 'sug', sugestao_compra_proprio(99318, current_date - 30, current_date, current_date, current_date + 15)
  union all select 'pos', to_jsonb(x) from posicao_proprio_em_data(99318, current_date) x;
  select count(*) into n from ((select * from t317_antes except select * from t317_depois) union all (select * from t317_depois except select * from t317_antes)) x;
  if n > 0 then raise notice 'DIF %', (select jsonb_agg(x) from ((select 'antes' w, * from t317_antes except select 'antes', * from t317_depois) union all (select 'depois', * from t317_depois except select 'depois', * from t317_antes)) x); end if;
  assert n = 0, 'leitores mudaram sem revisão: ' || n;
  assert (select count(*) from t317_antes) >= 10, 'comparou de verdade: ' || (select count(*) from t317_antes);

  -- 2) com revisão (reprocessa a coca: a nota antiga entra antes da venda), os leitores mostram o custo novo
  perform reprocessar_custo(99318, array[COCA], d - 6, 'nota antiga');
  -- venda de 3: (10·5 + 20·4)/30 = 4,333333 → 13,00 em vez de 12,00
  select v into j from (select to_jsonb(x) as v from relatorio_movimentacao_valor_mov(99318, current_date - 30, current_date) x) y
   where v->>'origem' = 'Venda' and (v->>'n_cod_prod')::bigint = COCA;
  assert (j->>'valor')::numeric = 13, 'relatório de movimentação com o custo revisado: ' || j::text;
  assert (select round(valor_movimentado, 2) from curva_abc(99318, 90) where codigo_produto = COCA) = 13, 'curva ABC com o custo revisado';
  assert (select cmc from posicao_proprio_em_data(99318, current_date) where codigo_produto = COCA)
       = (select cmc from estoque_custos where loja_id = 99318 and codigo_produto = COCA), 'Bloco H = CMC da cadeia';

  -- 3) decisão do dono: vendido antes da 1ª compra (S0 = −5, C0 = 0) + compra de 10 a 4 → CMC 4 ao vivo e na cadeia
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99318, 8000000031814, '31814', 'Limão 317', 'KG', '00');
  perform registrar_movimento(99318, L, 8000000031814, 'SAI', 'VENDA', 'l1', 5, null, null, null, 0, null, null, d - 2);
  r := registrar_movimento(99318, L, 8000000031814, 'ENT', 'COMPRA', 'l2', 10, 4.00, null, null, 0, null, null, d - 1);
  assert (r->>'cmc')::numeric = 4, 'ao vivo: CMC = custo da 1ª compra: ' || r::text;
  r := reprocessar_custo(99318, array[8000000031814::bigint], d - 2, 'confere');
  assert (r->>'movimentos_revisados')::int = 0, 'a cadeia dá o mesmo número que o ao vivo: ' || r::text;
  assert (select cmc from posicao_proprio_em_data(99318, current_date) where codigo_produto = 8000000031814) = 4, 'Bloco H também';

  -- 4) Bloco H tira o par de estorno do custo médio, como a cadeia
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99318, 8000000031815, '31815', 'Gelo 317', 'UN', '00');
  perform registrar_movimento(99318, L, 8000000031815, 'ENT', 'COMPRA', 'g1', 10, 2.00, null, null, 0, null, null, d - 3);
  r := registrar_movimento(99318, L, 8000000031815, 'ENT', 'COMPRA', 'g2', 100, 60.00, null, null, 0, null, null, d - 2);
  perform estornar_movimento((r->>'id')::bigint, null, 'fardo');
  perform reprocessar_custo(99318, array[8000000031815::bigint], d - 3, 'fardo');
  assert (select cmc from posicao_proprio_em_data(99318, current_date) where codigo_produto = 8000000031815) = 2
     and (select cmc from estoque_custos where loja_id = 99318 and codigo_produto = 8000000031815) = 2, 'par fora do Bloco H e da cadeia';

  -- 5) prato de OP com um insumo sem custo: entrada estimada mas com custo > 0 — Bloco H = estoque_custos
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
    (99318, 8000000031816, '31816', 'Farinha 317', 'KG', '00'), (99318, 8000000031817, '31817', 'Corante 317', 'KG', '00'),
    (99318, 8000000031818, '31818', 'Pão 317', 'UN', '04');
  declare v_f2 bigint; begin
    insert into fichas_tecnicas (loja_id, codigo_produto, versao, rendimento) values (99318, 8000000031818, 1, 1) returning id into v_f2;
    insert into ficha_tecnica_itens (ficha_id, loja_id, codigo_insumo, quantidade_liquida, ordem) values
      (v_f2, 99318, 8000000031816, 1, 1), (v_f2, 99318, 8000000031817, 1, 2);
  end;
  perform registrar_movimento(99318, L, 8000000031816, 'ENT', 'COMPRA', 'f1', 10, 2.00);
  perform produzir(99318, 8000000031818, 1, L, L, 'op-pao', null, null);
  assert (select custo_estimado and custo_unitario = 2 from estoque_movimentos_efetivo where ref = 'op-pao' and codigo_produto = 8000000031818),
    'entrada do pão estimada (corante sem custo), a R$ 2';
  assert (select cmc from estoque_custos where loja_id = 99318 and codigo_produto = 8000000031818) = 2, 'estoque_custos = 2';
  assert (select cmc from posicao_proprio_em_data(99318, current_date) where codigo_produto = 8000000031818) = 2, 'Bloco H = estoque_custos (2)';
  r := reprocessar_custo(99318, array[8000000031816::bigint, 8000000031817], current_date - 1, 'confere pão');
  assert (select cmc from estoque_custos where loja_id = 99318 and codigo_produto = 8000000031818) = 2, 'cadeia também dá 2';
  raise notice '317 LEITORES CUSTO EFETIVO OK';
end $$;
