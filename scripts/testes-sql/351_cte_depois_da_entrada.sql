-- Teste da migration 351 (CT-e ligado depois da entrada refaz o custo da entrada pela data da nota). Loja 19
-- "ZZ NORTE ERP LAB" (proprio, is_test), TUDO dentro de BEGIN … ROLLBACK. Rodar com scripts/testes-sql/351_rodar.sh.
-- Caminho real: gravar_nota_sefaz → registrar_compra_sefaz → lancar_compra → saída → vincular_cte_compra →
-- desvincular_cte_compra. Espera: NOTICE "351 CTE DEPOIS DA ENTRADA OK". Nada fala com Omie nem com a SEFAZ.

do $$
declare
  L constant bigint := 19; LOC constant bigint := 8000000000019; PROD constant bigint := 8000000000258;
  CNPJ constant text := '99351000000191';
  CH constant text := '29261199351000019155001' || lpad('351001', 21, '0');
  r jsonb; v_nota bigint; v_comp bigint; v_mov bigint; v_sai bigint; v_cte bigint; v_led numeric; v_cmc_antes numeric; e record; v_esp numeric;
begin
  assert (select modo_estoque = 'proprio' and is_test from lojas where id = L), 'loja 19 tem de ser a loja-laboratório própria';

  -- nota de 10 un a R$ 10 (N3, frete é custo = S), entrada na data da nota (04/11)
  r := gravar_nota_sefaz(L, jsonb_build_object('chave', CH, 'numero', '000351', 'serie', '1', 'modelo', '55', 'emissao', '2026-11-04',
         'valor', 100, 'fornecedor_cnpj', CNPJ, 'fornecedor_nome', 'ATACADO TESTE 351 LTDA', 'ambiente', '2', 'etapa', '40'), '[]'::jsonb);
  v_nota := (r->>'nota_id')::bigint;
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', L, 'chave_acesso', CH, 'numero', '000351', 'serie', '1', 'fornecedor_cnpj', CNPJ,
         'fornecedor_nome', 'ATACADO TESTE 351 LTDA', 'emissao', '2026-11-04', 'nota_fiscal_id', v_nota,
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'c_prod', 'A351', 'descricao', 'ACUCAR 351', 'quantidade', 10,
            'valor_unitario', 10, 'valor_total', 100, 'valor_total_item', 100, 'codigo_produto', PROD, 'fator', 1,
            'custo_flags', 'NNNNNNSS', 'origem_flags', 'regra', 'codigo_local_estoque', LOC, 'movimenta_estoque', true))), LOC);
  v_comp := (r->>'compra_id')::bigint;
  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  assert r->>'status' = 'lancada', 'entrada: ' || r::text;
  select movimento_id into v_mov from compras_proprio_itens where compra_id = v_comp and linha = 1;
  select custo_unitario into v_led from estoque_movimentos where id = v_mov;
  assert v_led = 10, 'custo da entrada sem CT-e = 10, veio ' || v_led;

  -- uma saída depois da entrada (sai pelo custo médio)
  r := registrar_movimento(L, LOC, PROD, 'SAI', 'AJUSTE_MANUAL', 'teste-351-sai', -1, null, null, 'teste 351', 0, null, null, null);
  v_sai := (r->>'id')::bigint;
  select cmc_apos into v_cmc_antes from estoque_movimentos_efetivo where id = v_mov;

  -- liga um CT-e de R$ 20 DEPOIS da entrada: antes da 351 dava "já entrou no estoque"
  insert into compras_proprio_cte (loja_id, numero, transportadora_nome, valor, origem) values (L, '351', 'TRANSP 351', 20, 'manual') returning id into v_cte;
  r := vincular_cte_compra(L, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_comp, 'valor', 20)), null);
  assert (r->'custo_refeito'->>'entradas_revisadas')::int = 1, 'refez 1 entrada: ' || r::text;
  select * into e from estoque_movimentos_efetivo where id = v_mov;
  assert e.custo_unitario = 12 and e.custo_original = 12, 'custo da entrada com frete = (100 + 20) / 10 = 12: ' || row_to_json(e)::text;
  assert e.data_ref = '2026-11-04', 'data da nota mantida: ' || e.data_ref;
  assert e.cmc_apos > v_cmc_antes, 'CMC depois da entrada subiu: ' || v_cmc_antes || ' → ' || e.cmc_apos;
  assert (select custo_unitario from estoque_movimentos where id = v_mov) = 10, 'ledger intacto (sem UPDATE)';
  assert (select custo_unitario_base from compras_proprio_itens where movimento_id = v_mov) = 12, 'custo do item da nota';
  assert exists (select 1 from estoque_mov_revisao where movimento_id = v_mov and motivo like 'custo da entrada: CT-e 351 ligado%'), 'revisão de custo da entrada';
  -- a saída seguinte foi refeita pelo CMC vigente na cadeia (data efetiva, id)
  select x.cmc_apos into v_esp from estoque_movimentos_efetivo x
   where x.loja_id = L and x.codigo_produto = PROD and (x.data_ref, x.id) < ((select data_ref from estoque_movimentos_efetivo where id = v_sai), v_sai)
   order by x.data_ref desc, x.id desc limit 1;
  assert (select custo_unitario from estoque_movimentos_efetivo where id = v_sai) = v_esp, 'saída refeita pelo CMC novo';
  assert (select cmc from estoque_custos where loja_id = L and codigo_produto = PROD) = (select cmc_apos from estoque_movimentos_efetivo
          where loja_id = L and codigo_produto = PROD order by data_ref desc, id desc limit 1), 'estoque_custos no fim da cadeia';

  -- religar o mesmo CT-e não soma de novo
  r := vincular_cte_compra(L, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_comp, 'valor', 20)), null);
  assert (r->'custo_refeito'->>'entradas_revisadas')::int = 0 and (select custo_unitario from estoque_movimentos_efetivo where id = v_mov) = 12, 'idempotente';

  -- desligar volta ao custo sem frete
  r := desvincular_cte_compra(L, v_cte, null);
  assert (select custo_original from estoque_movimentos_efetivo where id = v_mov) = 10
     and (select custo_unitario from estoque_movimentos_efetivo where id = v_mov) = 10, 'CT-e desligado: custo 10 de novo';

  -- mês fechado: recusa (PF001) e nada muda
  insert into estoque_periodo_fechado (loja_id, mes, fechado_por) values (L, '2026-11-01', 'teste 351');
  begin
    r := vincular_cte_compra(L, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_comp, 'valor', 20)), null);
    raise exception 'devia recusar em mês fechado';
  exception when sqlstate 'PF001' then null;
  end;

  raise notice '351 CTE DEPOIS DA ENTRADA OK';
end $$;
