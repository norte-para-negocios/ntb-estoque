-- Teste da migration 410 (versão da ficha por movimento, sub-receitas, ciclo e OP com custo real × teórico).
-- Rodar com scripts/testes-sql/410_rodar.sh (BEGIN … ROLLBACK, nada fica gravado). Escreve só na loja 19 "ZZ NORTE ERP LAB",
-- em 4 produtos sem movimento nem ficha: Farinha (X, insumo), Leite de Coco (Y, insumo), Molho da Casa (P, pré-preparo)
-- e Moqueca (D, prato), no local Cozinha. A ODARA (15) só é LIDA (tempo das funções).
do $$
declare
  L constant bigint := 19; LOC constant bigint := 8000000000021;
  X constant bigint := 8000000000022; Y constant bigint := 8000000000026; P constant bigint := 8000000000055; D constant bigint := 8000000000037;
  r jsonb; fP1 bigint; fP2 bigint; fD1 bigint; v_ok boolean; v_mov bigint; v_est bigint; rr record; c record;
  v_ids bigint[]; v_saldo_antes numeric; v_cmc_antes numeric; t0 timestamptz; v_ms numeric; v_ref text;
begin
  assert (select modo_estoque = 'proprio' and is_test from lojas where id = L), 'loja 19 tem de ser a loja-laboratório própria';
  assert not exists (select 1 from estoque_movimentos where loja_id = L and codigo_produto in (X, Y, P, D)), 'produtos de teste sem movimento';
  assert not exists (select 1 from fichas_tecnicas where loja_id = L and codigo_produto in (X, Y, P, D)), 'produtos de teste sem ficha';

  -- 0) a 410 não mexe em nenhuma função que grava (corpo igual ao de produção em 06/11/2026)
  assert md5(pg_get_functiondef('produzir'::regproc)) = '8663f34e4cd1ceaba1c3d6468fcbcea0', 'produzir intacto';
  assert md5(pg_get_functiondef('consumo_por_receita'::regproc)) = '44fef3565bfcce0a37140c8294c937c9', 'consumo_por_receita intacto';
  assert md5(pg_get_functiondef('registrar_movimento'::regproc)) = 'b3cc6d941ca5d1734ea32f8ca8fb65d4', 'registrar_movimento intacto';
  assert md5(pg_get_functiondef('salvar_ficha'::regproc)) = '25856237b1cd086b0b136aaee915666c', 'salvar_ficha intacto';
  assert (select bool_and(provolatile = 's') from pg_proc where pronamespace = 'public'::regnamespace
           and proname in ('ficha_versao_dos_movimentos', '_custo_insumo_em', '_ficha_em', '_custo_ficha_em', 'op_custo_real_teorico')),
         'funções novas são só leitura (STABLE)';

  -- 1) estoque inicial: X 10 a R$ 2, Y 10 a R$ 3
  perform registrar_movimento(L, LOC, X, 'ENT', 'ENTRADA_MANUAL', 't410-x', 10, 2, null, 'teste 410');
  perform registrar_movimento(L, LOC, Y, 'ENT', 'ENTRADA_MANUAL', 't410-y', 10, 3, null, 'teste 410');

  -- 2) fichas: P (molho) = 1 X; D (moqueca) = 0,5 P + 1 Y. P não abre na baixa (expandir_na_venda = false, regra atual)
  fP1 := (salvar_ficha(L, P, 1, '[{"codigo_insumo": 8000000000022, "quantidade_liquida": 1}]'::jsonb, false, 'teste 410') ->> 'ficha_id')::bigint;
  fD1 := (salvar_ficha(L, D, 1, '[{"codigo_insumo": 8000000000055, "quantidade_liquida": 0.5}, {"codigo_insumo": 8000000000026, "quantidade_liquida": 1}]'::jsonb,
                       false, 'teste 410') ->> 'ficha_id')::bigint;

  -- 3) ciclo: recusado ao salvar, direto e indireto, sem estragar a ficha que já existia
  v_ok := false;
  begin
    perform salvar_ficha(L, P, 1, '[{"codigo_insumo": 8000000000055, "quantidade_liquida": 1}]'::jsonb, false, 'teste 410');
  exception when sqlstate '23514' then v_ok := true;
  end;
  assert v_ok, 'ficha que contém o próprio produto é recusada';
  v_ok := false;
  begin
    -- X passa a usar D, mas D → P → X: ciclo de 3 níveis
    perform salvar_ficha(L, X, 1, '[{"codigo_insumo": 8000000000037, "quantidade_liquida": 1}]'::jsonb, false, 'teste 410');
  exception when sqlstate '23514' then v_ok := true;
  end;
  assert v_ok, 'ciclo indireto (X → D → P → X) é recusado';
  v_ok := false;
  begin
    -- P passa a usar D (D já usa P): ciclo de 2 níveis
    perform salvar_ficha(L, P, 1, '[{"codigo_insumo": 8000000000037, "quantidade_liquida": 1}]'::jsonb, false, 'teste 410');
  exception when sqlstate '23514' then v_ok := true;
  end;
  assert v_ok, 'ciclo P → D → P é recusado';
  assert (select id from fichas_tecnicas where loja_id = L and codigo_produto = P and ativa) = fP1, 'recusa não troca a ficha ativa do P';
  assert not exists (select 1 from fichas_tecnicas where loja_id = L and codigo_produto = X), 'recusa não deixa ficha do X';

  -- 4) OP 1 do molho com a v1: 2 un = 2 X a R$ 2
  r := produzir(L, P, 2, LOC, LOC, 't410-op1', 'teste 410');
  assert (r ->> 'custo_total')::numeric = 4, format('op1 custo 4 (veio %s)', r ->> 'custo_total');

  -- 5) ficha nova do molho (v2: 1,5 X) e OP 2: 1 un = 1,5 X a R$ 2 = 3
  r := salvar_ficha(L, P, 1, '[{"codigo_insumo": 8000000000022, "quantidade_liquida": 1.5}]'::jsonb, false, 'teste 410');
  fP2 := (r ->> 'ficha_id')::bigint;
  assert (r ->> 'versao')::int = 2, 'salvar de novo = versão 2';
  r := produzir(L, P, 1, LOC, LOC, 't410-op2', 'teste 410');
  assert (r ->> 'custo_total')::numeric = 3, 'op2 custo 3';

  -- 6) versão gravada por movimento: OP 1 → v1, OP 2 → v2 (consumo do insumo e entrada do produto)
  select array_agg(id) into v_ids from estoque_movimentos where loja_id = L and origem = 'PRODUCAO' and ref in ('t410-op1', 't410-op2');
  assert array_length(v_ids, 1) = 4, '4 movimentos das duas OPs';
  for rr in select m.ref, m.codigo_produto, v.ficha_id, v.versao, v.via
             from estoque_movimentos m left join ficha_versao_dos_movimentos(L, v_ids) v on v.movimento_id = m.id
            where m.id = any (v_ids) loop
    assert rr.via = 'op', format('mov %s %s veio pela OP', rr.ref, rr.codigo_produto);
    if rr.ref = 't410-op1' then assert rr.ficha_id = fP1 and rr.versao = 1, format('op1 → ficha v1 (veio %s v%s)', rr.ficha_id, rr.versao);
    else assert rr.ficha_id = fP2 and rr.versao = 2, format('op2 → ficha v2 (veio %s v%s)', rr.ficha_id, rr.versao); end if;
  end loop;

  -- 7) baixa pela venda (consumo_por_receita): 1 moqueca = 0,5 P (do estoque do P, não aberto) + 1 Y → ficha da moqueca v1
  r := consumo_por_receita(L, D, 1, LOC, 't410-v1', 'teste 410');
  assert (r ->> 'versao')::int = 1 and (r ->> 'ficha_id')::bigint = fD1, 'consumo devolve a ficha usada';
  assert (select count(*) from estoque_movimentos where loja_id = L and origem = 'VENDA' and ref like 't410-v1|%' and codigo_produto = P) = 1,
         'PI produzido por OP sai do estoque do PI (não explode em X)';
  assert not exists (select 1 from estoque_movimentos where loja_id = L and origem = 'VENDA' and ref like 't410-v1|%' and codigo_produto = X),
         'X não sai na venda';
  select array_agg(id) into v_ids from estoque_movimentos where loja_id = L and origem = 'VENDA' and ref like 't410-v1|%';
  assert (select count(*) from ficha_versao_dos_movimentos(L, v_ids) v where v.ficha_id = fD1 and v.versao = 1 and v.via = 'venda') = 2,
         'os 2 movimentos da venda → moqueca v1';
  -- estorno herda a versão do movimento desfeito
  select id into v_mov from estoque_movimentos where loja_id = L and origem = 'VENDA' and ref like 't410-v1|%' and codigo_produto = Y;
  v_est := (estornar_movimento(v_mov, null, 'teste 410') ->> 'id')::bigint;
  assert (select versao from ficha_versao_dos_movimentos(L, array[v_est])) = 1, 'estorno → moqueca v1';
  assert not exists (select 1 from ficha_versao_dos_movimentos(L, array[(select id from estoque_movimentos where loja_id = L and ref = 't410-x')])),
         'entrada manual não tem ficha';

  -- 8) OP do prato: 2 moquecas = 1 P (custo médio do P = 7 ÷ 3) + 2 Y a R$ 3
  v_saldo_antes := (select sum(saldo) from estoque_saldos where loja_id = L and codigo_produto in (X, Y, P, D));
  v_cmc_antes := (select sum(cmc) from estoque_custos where loja_id = L and codigo_produto in (X, Y, P, D));
  r := produzir(L, D, 2, LOC, LOC, 't410-op3', 'teste 410');
  r := op_custo_real_teorico(L, 't410-op3');
  assert (r ->> 'versao')::int = 1 and (r ->> 'ficha_id')::bigint = fD1, 'op3 usou a moqueca v1';
  assert round((r ->> 'custo_real')::numeric, 4) = 8.3333, format('real = 1 × 2,3333 + 2 × 3 (veio %s)', r ->> 'custo_real');
  assert round((r ->> 'custo_gravado')::numeric, 4) = 8.3333, 'gravado = real sem revisão';
  -- teórico: P pela ficha dele (v2, a do momento: 1,5 X × R$ 2 = R$ 3/un) → 1 × 3 + 2 × 3 = 9
  assert round((r ->> 'custo_teorico')::numeric, 4) = 9, format('teórico 9 (veio %s)', r ->> 'custo_teorico');
  assert round((r ->> 'diferenca')::numeric, 4) = -0.6667, format('diferença −0,6667 (veio %s)', r ->> 'diferenca');
  select * into c from jsonb_to_recordset(r -> 'itens') as t(codigo_insumo bigint, sub_receita boolean, versao_sub int, custo_unit_teorico numeric, custo_unit_real numeric)
   where codigo_insumo = P;
  assert c.sub_receita and c.versao_sub = 2 and c.custo_unit_teorico = 3 and round(c.custo_unit_real, 4) = 2.3333, 'linha do PI: real 2,3333 × teórico 3 (ficha v2)';
  -- ler não muda saldo nem custo
  perform op_custo_real_teorico(L, 't410-op3'); perform ficha_versao_dos_movimentos(L, v_ids);
  assert v_saldo_antes - 1 - 2 + 2 = (select sum(saldo) from estoque_saldos where loja_id = L and codigo_produto in (X, Y, P, D)), 'saldo só mudou pela OP';

  -- 9) custo real segue a revisão do ledger efetivo (311–317): Y da OP 3 revisado de R$ 3 para R$ 4
  select * into rr from estoque_movimentos where loja_id = L and origem = 'PRODUCAO' and ref = 't410-op3' and codigo_produto = Y;
  perform _revisar_movimento(rr.id, gen_random_uuid(), rr.data_ref, 4, rr.cmc_apos, rr.saldo_apos, rr.saldo_total_apos, false, 'teste 410: custo revisto');
  r := op_custo_real_teorico(L, 't410-op3');
  assert round((r ->> 'custo_real')::numeric, 4) = 10.3333, format('real com a revisão 10,3333 (veio %s)', r ->> 'custo_real');
  assert round((r ->> 'custo_gravado')::numeric, 4) = 8.3333, 'gravado da OP não muda com a revisão';
  assert round((r ->> 'diferenca')::numeric, 4) = 1.3333, 'diferença 1,3333';

  -- 10) permissões: só o servidor (service_role)
  assert not has_function_privilege('authenticated', 'op_custo_real_teorico(bigint,text)', 'execute'), 'sem grant authenticated';
  assert not has_function_privilege('anon', 'ficha_versao_dos_movimentos(bigint,bigint[])', 'execute'), 'sem grant anon';
  assert has_function_privilege('service_role', 'op_custo_real_teorico(bigint,text)', 'execute'), 'service_role chama';

  -- 11) tempo na ODARA (só leitura): 50 OPs com sub-receita e 100 movimentos de OP
  t0 := clock_timestamp();
  for v_ref in select o.ref from ordens_producao_proprio o where o.loja_id = 15 order by o.id desc limit 50 loop
    perform op_custo_real_teorico(15, v_ref);
  end loop;
  v_ms := extract(epoch from clock_timestamp() - t0) * 1000 / 50;
  raise notice 'op_custo_real_teorico ODARA: % ms por OP', round(v_ms, 1);
  assert v_ms < 200, 'menos de 200 ms por OP';
  t0 := clock_timestamp();
  perform count(*) from ficha_versao_dos_movimentos(15, (select array_agg(id) from (select id from estoque_movimentos where loja_id = 15 and origem = 'PRODUCAO' order by id desc limit 100) s));
  v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'ficha_versao_dos_movimentos ODARA (100 movimentos): % ms', round(v_ms, 1);
  assert v_ms < 500, 'versões de 100 movimentos abaixo de 0,5 s';

  raise notice '410 FICHA VERSAO CUSTO OP OK';
end $$;
