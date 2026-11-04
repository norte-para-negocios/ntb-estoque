-- Teste da migration 316 (corrigir_data_entradas_compra). CÓPIA local, nunca produção. Precisa de 311–315:
--   begin; \i …/311 \i …/312 \i …/313 \i …/314 \i …/315 \i supabase/migrations/316_corrigir_data_entradas.sql
--          \i scripts/testes-sql/316_corrigir_data_entradas.sql rollback;
-- Cenário da ODARA: ledger começa em 13/10; notas de 09/10 (coca) e 15/10 (camarão) lançadas em 02/11 (regra antiga);
-- vendas de 20/10 saíram a custo 0. Espera: NOTICE "316 CORRIGIR DATA ENTRADAS OK".
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values
  (99316, '00000000099316', 'TESTE 316', true, 'proprio'), (99317, '00000000099317', 'TESTE 316 OMIE', true, 'omie');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99316, 8000000031601, 'Estoque', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99316, 8000000031611, '31611', 'Coca 316', 'UN', '00'),
  (99316, 8000000031612, '31612', 'Camarão 316', 'KG', '00'),
  (99316, 8000000031613, '31613', 'Moqueca 316', 'UN', '04'),
  (99316, 8000000031614, '31614', 'Gelo 316', 'UN', '00');

do $$
declare L bigint := 8000000031601; COCA bigint := 8000000031611; CAM bigint := 8000000031612; MOQ bigint := 8000000031613;
        CH1 text := '29261000000000000000550010000000011000000316'; CH2 text := '29261000000000000000550010000000021000000316';
        r jsonb; v1 bigint; v2 bigint; n_rev int; msg text; det text; j jsonb; e record;
begin
  -- início do ledger (contagem inicial) em 13/10
  perform registrar_movimento(99316, L, 8000000031614, 'AJU', 'SALDO_INICIAL', 'ini', 5, 1.00, null, null, 0, null, null, '2026-10-13');
  -- gelo: só um fardo errado estornado (nenhuma entrada a mover), CMC distorcido pelo par
  perform registrar_movimento(99316, L, 8000000031614, 'ENT', 'COMPRA', 'g1', 10, 2.00, null, null, 0, null, null, '2026-10-14');
  r := registrar_movimento(99316, L, 8000000031614, 'ENT', 'COMPRA', 'g2', 100, 60.00, null, null, 0, null, null, '2026-10-15');
  perform registrar_movimento(99316, L, 8000000031614, 'SAI', 'VENDA', 'g3', 5, null, null, null, 0, null, null, '2026-10-16');
  perform estornar_movimento((r->>'id')::bigint, null, 'fardo');
  -- vendas de 20/10: coca direta; moqueca feita por OP que consome camarão (tudo sem custo)
  perform registrar_movimento(99316, L, COCA, 'SAI', 'VENDA', 'p316-1', 6, null, null, null, 0, null, null, '2026-10-20');
  perform registrar_movimento(99316, L, CAM, 'PRD', 'PRODUCAO', 'op316', -0.5, null, null, null, 0, null, null, '2026-10-20');
  perform registrar_movimento(99316, L, MOQ, 'PRD', 'PRODUCAO', 'op316', 1, null, null, null, 0, null, null, '2026-10-20');
  perform registrar_movimento(99316, L, MOQ, 'SAI', 'VENDA', 'p316-2', 1, null, null, null, 0, null, null, '2026-10-20');
  insert into vendas_proprio (loja_id, pedido_ref, data, valor) values (99316, 'p316-1', '2026-10-20', 60) returning id into v1;
  insert into vendas_proprio (loja_id, pedido_ref, data, valor) values (99316, 'p316-2', '2026-10-20', 90) returning id into v2;
  insert into vendas_proprio_itens (venda_id, linha, codigo_produto, nome, quantidade, valor) values (v1, 1, COCA, 'Coca', 6, 60), (v2, 1, MOQ, 'Moqueca', 1, 90);
  -- notas lançadas em 02/11 como era antes da 313 (data_entrada explícita = dia do lançamento)
  insert into sefaz_documentos (loja_id, nsu, tipo, chave, completo, xml) values
    (99316, '000000000316001', 'procNFe', CH1, true, '<nfeProc><ide><dhEmi>2026-10-09T08:00:00-03:00</dhEmi><dhSaiEnt>2026-10-09T08:00:00-03:00</dhSaiEnt></ide></nfeProc>');
  perform lancar_compra(jsonb_build_object('loja_id', 99316, 'chave_acesso', CH1, 'numero', '1', 'emissao', '2026-10-09', 'data_entrada', '2026-11-02',
    'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 24, 'valor_unitario', 3.79, 'valor_total', 90.96, 'codigo_produto', COCA))), L, null);
  perform lancar_compra(jsonb_build_object('loja_id', 99316, 'chave_acesso', CH2, 'numero', '2', 'emissao', '2026-10-15', 'data_entrada', '2026-11-02',
    'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 2, 'valor_unitario', 80, 'valor_total', 160, 'codigo_produto', CAM))), L, null);
  assert (select custo_unitario from estoque_movimentos_efetivo where ref = 'p316-1' and loja_id = 99316) = 0, 'antes: coca de 20/10 a 0';
  select count(*) into n_rev from estoque_mov_revisao;

  -- 1) prévia: devolve os números e não grava nada
  begin
    perform corrigir_data_entradas_compra(99316, '2026-10-01', 'correcao custo outubro', true);
    raise exception 'prévia deveria terminar com PF900';
  exception when sqlstate 'PF900' then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
  end;
  j := det::jsonb;
  assert msg like 'Prévia%', 'mensagem da prévia: ' || msg;
  assert (j->>'compras')::int = 2 and (j->>'movimentos_revisados')::int = 2, 'prévia conta 2 compras: ' || j::text;
  assert (j->'cmv_antes'->>'2026-10')::numeric = 0, 'CMV de outubro antes = 0: ' || j::text;
  -- coca 6 × 3,79 = 22,74; moqueca 0,5 × 80 = 40 → 62,74
  assert (j->'cmv_depois'->>'2026-10')::numeric = 62.74, 'CMV de outubro depois: ' || j::text;
  assert (select count(*) from estoque_mov_revisao) = n_rev, 'prévia não gravou revisão';
  assert (select custo_unitario from estoque_movimentos_efetivo where ref = 'p316-1' and loja_id = 99316) = 0, 'prévia não mudou a venda';

  -- 2) de verdade
  r := corrigir_data_entradas_compra(99316, '2026-10-01', 'correcao custo outubro');
  assert (r->>'compras')::int = 2 and (r->>'movimentos_revisados')::int = 2, 'corrigiu 2 entradas: ' || r::text;
  assert r->'produtos' @> to_jsonb(array[COCA, CAM]), 'produtos afetados: ' || r::text;
  assert r->>'lote_reprocesso' is not null, 'reprocessou uma vez';
  -- a nota de 09/10 é antes do início do ledger: vale 13/10
  assert (select ef.data_ref from estoque_movimentos_efetivo ef join compras_proprio c on c.chave_acesso = CH1 join compras_proprio_itens i on i.compra_id = c.id
           where ef.id = i.movimento_id) = '2026-10-13', 'nota de 09/10 entra no início do ledger (13/10)';
  assert (select ef.data_ref from estoque_movimentos_efetivo ef join compras_proprio c on c.chave_acesso = CH2 join compras_proprio_itens i on i.compra_id = c.id
           where ef.id = i.movimento_id) = '2026-10-15', 'nota de 15/10 na data dela';
  assert (select custo_unitario from estoque_movimentos_efetivo where ref = 'p316-1' and loja_id = 99316) = 3.79, 'venda da coca de 20/10 com custo';
  assert (select custo_unitario from estoque_movimentos_efetivo where ref = 'p316-2' and loja_id = 99316) = 40, 'venda da moqueca com custo (cascata)';
  for e in select c.codigo_produto, c.cmc, c.saldo_total, u.cmc_apos, u.saldo_total_apos from estoque_custos c
             join lateral (select cmc_apos, saldo_total_apos from estoque_movimentos_efetivo x where x.loja_id = c.loja_id and x.codigo_produto = c.codigo_produto
                            order by data_ref desc, id desc limit 1) u on true where c.loja_id = 99316 loop
    assert e.cmc = e.cmc_apos and e.saldo_total = e.saldo_total_apos, 'CMC de hoje = fim da cadeia: ' || row_to_json(e)::text;
  end loop;
  assert (select sum(cmv) from vendas_proprio_cmv where loja_id = 99316) = 62.74, 'CMV gravado = prévia';
  -- gelo (só par de estorno) também foi refeito: ini 5 a 1 (13/10) + 10 a 2 → (5 + 20)/15 = 1,666667; o fardo sai da cadeia
  assert (r->>'produtos_reprocessados')::int = 4, 'reprocessa todos os produtos com movimento desde 01/10: ' || r::text;
  assert (select cmc from estoque_custos where loja_id = 99316 and codigo_produto = 8000000031614) = 1.666667,
    'CMC do gelo sem o fardo: ' || (select cmc from estoque_custos where loja_id = 99316 and codigo_produto = 8000000031614);

  -- 3) segunda chamada não grava nada
  select count(*) into n_rev from estoque_mov_revisao;
  r := corrigir_data_entradas_compra(99316, '2026-10-01', 'de novo');
  assert (r->>'compras')::int = 0 and (r->>'movimentos_revisados')::int = 0 and (r->>'custos_revisados')::int = 0, 'idempotente: ' || r::text;
  assert (select count(*) from estoque_mov_revisao) = n_rev, 'nenhuma revisão nova';

  -- 4) loja Omie recusada; sem acesso pela API
  begin
    perform corrigir_data_entradas_compra(99317, '2026-10-01', 'x');
    raise exception 'omie deveria falhar';
  exception when sqlstate '22023' then null;
  end;
  assert not has_function_privilege('service_role', 'corrigir_data_entradas_compra(bigint,date,text,boolean)', 'execute'), 'service_role não executa';
  assert not has_function_privilege('authenticated', 'corrigir_data_entradas_compra(bigint,date,text,boolean)', 'execute'), 'authenticated não executa';
  raise notice '316 CORRIGIR DATA ENTRADAS OK';
end $$;
