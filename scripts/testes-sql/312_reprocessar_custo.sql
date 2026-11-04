-- Teste da migration 312 (reprocessar_custo). Roda numa CÓPIA local (Postgres 17, pg_dump --schema-only da produção +
-- roles do Supabase), nunca em produção. Precisa da 311. Tudo dentro de BEGIN … ROLLBACK:
--   begin; \i supabase/migrations/311_custo_revisao.sql \i supabase/migrations/312_reprocessar_custo.sql
--          \i scripts/testes-sql/312_reprocessar_custo.sql rollback;
-- Espera: NOTICE "312 REPROCESSAR CUSTO OK".
-- Os números batem com lib/estoque/reprocessar-custo-puro.test.ts (mesma regra em TS).
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values
  (99320, '00000000099320', 'TESTE 312', true, 'proprio'),
  (99321, '00000000099321', 'TESTE 312 OMIE', true, 'omie');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values
  (99320, 8000000032001, 'Estoque', 'S'), (99320, 8000000032002, 'Cozinha', 'N');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99320, 8000000032011, '32011', 'Coca Zero 312', 'UN', '00'),
  (99320, 8000000032012, '32012', 'Camarão 312', 'KG', '00'),
  (99320, 8000000032013, '32013', 'Molho de camarão (PI) 312', 'KG', '06'),
  (99320, 8000000032014, '32014', 'Moqueca 312', 'UN', '04'),
  (99320, 8000000032015, '32015', 'Ciclo A 312', 'UN', '06'),
  (99320, 8000000032016, '32016', 'Ciclo B 312', 'UN', '06'),
  (99320, 8000000032017, '32017', 'Gelo 312', 'UN', '00');

do $$
declare L bigint := 8000000032001; K bigint := 8000000032002;
        COCA bigint := 8000000032011; CAM bigint := 8000000032012; MOLHO bigint := 8000000032013; MOQ bigint := 8000000032014;
        CA bigint := 8000000032015; CB bigint := 8000000032016; GELO bigint := 8000000032017;
        r jsonb; v_venda bigint; v_nota bigint; e record; c record; n int; s numeric; msg text; v_fardo bigint;
begin
  ---------------------------------------------------------------------------------------------------------------
  -- 1) Nota lançada depois de vendas que já consumiram o produto (Review Focus 1)
  perform registrar_movimento(99320, L, COCA, 'ENT', 'COMPRA', 'n0', 4, 5.00, null, null, 0, null, null, '2026-10-05');
  r := registrar_movimento(99320, L, COCA, 'SAI', 'VENDA', 'v1', 6, null, null, null, 0, null, null, '2026-10-20');
  v_venda := (r->>'id')::bigint;
  -- nota de 09/10 chega e é lançada com a data dela (registrar grava o CMC do momento, ainda errado)
  r := registrar_movimento(99320, L, COCA, 'ENT', 'COMPRA', 'n1', 10, 4.00, null, null, 0, null, null, '2026-10-09');
  v_nota := (r->>'id')::bigint;
  r := reprocessar_custo(99320, array[COCA], '2026-10-09', 'teste nota atrasada');
  assert (r->>'movimentos_revisados')::int = 2, 'revisa a nota e a venda: ' || r::text;
  assert r->>'desde_efetivo' = '2026-10-09', 'desde efetivo';
  select * into e from estoque_movimentos_efetivo where id = v_venda;
  assert e.custo_unitario = 4.285714 and e.revisado, 'a venda de 20/10 ganha o custo novo: ' || e.custo_unitario;
  assert e.saldo_apos = 8, 'saldo depois da venda na ordem nova ' || e.saldo_apos;
  select * into e from estoque_movimentos_efetivo where id = v_nota;
  assert e.cmc_apos = 4.285714 and e.saldo_apos = 14, 'nota pondera com S0=4, C0=5';
  select * into c from estoque_custos where loja_id = 99320 and codigo_produto = COCA;
  assert c.cmc = 4.285714, 'CMC de hoje = fim da cadeia ' || c.cmc;
  assert c.saldo_total = (select sum(quantidade) from estoque_movimentos where loja_id = 99320 and codigo_produto = COCA), 'saldo = soma do ledger';
  assert c.ultimo_custo = 4, 'último custo = última entrada com custo na ordem da cadeia';
  assert (select saldo from estoque_saldos where loja_id = 99320 and codigo_produto = COCA and codigo_local_estoque = L) = 8, 'saldo do local intacto';
  -- o último efetivo da cadeia = estoque_custos
  select * into e from estoque_movimentos_efetivo where loja_id = 99320 and codigo_produto = COCA order by data_ref desc, id desc limit 1;
  assert e.cmc_apos = c.cmc and e.saldo_total_apos = c.saldo_total, 'último efetivo = estoque_custos';
  -- rodar de novo não muda nada
  r := reprocessar_custo(99320, array[COCA], '2026-10-01', 'teste de novo');
  assert (r->>'movimentos_revisados')::int = 0, 'segunda passada não revisa nada: ' || r::text;

  ---------------------------------------------------------------------------------------------------------------
  -- 2) Cascata com sub-receita: camarão → molho (PI, OP1) → moqueca (OP2) → venda (Review Focus 2)
  -- OPs feitas quando o camarão estava sem custo (CMC 0): tudo sai a zero
  perform registrar_movimento(99320, K, CAM, 'PRD', 'PRODUCAO', 'op1', -2, null, null, null, 0, null, null, '2026-10-12');
  perform registrar_movimento(99320, K, MOLHO, 'PRD', 'PRODUCAO', 'op1', 4, null, null, null, 0, null, null, '2026-10-12');
  perform registrar_movimento(99320, K, MOLHO, 'PRD', 'PRODUCAO', 'op2', -1, null, null, null, 0, null, null, '2026-10-13');
  perform registrar_movimento(99320, K, MOQ, 'PRD', 'PRODUCAO', 'op2', 2, null, null, null, 0, null, null, '2026-10-13');
  r := registrar_movimento(99320, K, MOQ, 'SAI', 'VENDA', 'v2', 1, null, null, null, 0, null, null, '2026-10-14');
  v_venda := (r->>'id')::bigint;
  assert (select custo_unitario from estoque_movimentos where id = v_venda) = 0, 'antes: a moqueca saiu a zero';
  -- a nota do camarão (10/10, 5 kg a R$ 80) é lançada depois
  perform registrar_movimento(99320, L, CAM, 'ENT', 'COMPRA', 'n2', 5, 80.00, null, null, 0, null, null, '2026-10-10');
  r := reprocessar_custo(99320, array[CAM], '2026-10-10', 'teste cascata');
  assert r->'cascata' @> to_jsonb(array[MOLHO, MOQ]), 'molho e moqueca entram na cascata: ' || r::text;
  -- OP1: 2 kg × 80 = 160 ÷ 4 = 40/kg de molho; OP2: 1 × 40 = 40 ÷ 2 = 20 por moqueca
  select * into e from estoque_movimentos_efetivo where loja_id = 99320 and codigo_produto = MOLHO and ref = 'op1';
  assert e.custo_unitario = 40 and not e.custo_estimado, 'entrada do molho = Σ consumos ÷ produzido: ' || e.custo_unitario;
  select * into e from estoque_movimentos_efetivo where loja_id = 99320 and codigo_produto = MOQ and ref = 'op2';
  assert e.custo_unitario = 20, 'entrada da moqueca: ' || e.custo_unitario;
  select * into e from estoque_movimentos_efetivo where id = v_venda;
  assert e.custo_unitario = 20 and e.revisado, 'a venda da moqueca ganha o custo: ' || e.custo_unitario;
  assert (select cmc from estoque_custos where loja_id = 99320 and codigo_produto = MOQ) = 20, 'CMC da moqueca de hoje';

  ---------------------------------------------------------------------------------------------------------------
  -- 3) Ciclo de receita: não entra em laço, para em 20 níveis com aviso
  perform registrar_movimento(99320, K, CA, 'ENT', 'COMPRA', 'nca', 10, 1.00, null, null, 0, null, null, '2026-10-15');
  perform registrar_movimento(99320, K, CA, 'PRD', 'PRODUCAO', 'opx', -1, null, null, null, 0, null, null, '2026-10-16');
  perform registrar_movimento(99320, K, CB, 'PRD', 'PRODUCAO', 'opx', 1, null, null, null, 0, null, null, '2026-10-16');
  perform registrar_movimento(99320, K, CB, 'PRD', 'PRODUCAO', 'opy', -1, null, null, null, 0, null, null, '2026-10-17');
  perform registrar_movimento(99320, K, CA, 'PRD', 'PRODUCAO', 'opy', 1, null, null, null, 0, null, null, '2026-10-17');
  r := reprocessar_custo(99320, array[CA], '2026-10-15', 'teste ciclo');
  assert exists (select 1 from jsonb_array_elements_text(r->'avisos') a where a like '%20 níveis%'), 'aviso de ciclo: ' || r::text;

  ---------------------------------------------------------------------------------------------------------------
  -- 4) Entrada estornada (fardo): o par sai da cadeia e o CMC volta ao que seria sem ela (Review Focus 3)
  perform registrar_movimento(99320, L, GELO, 'ENT', 'COMPRA', 'g1', 10, 3.79, null, null, 0, null, null, '2026-10-20');
  r := registrar_movimento(99320, L, GELO, 'ENT', 'COMPRA', 'g2', 100, 60.00, null, null, 0, null, null, '2026-10-21');
  v_fardo := (r->>'id')::bigint;
  perform registrar_movimento(99320, L, GELO, 'SAI', 'VENDA', 'gv', 5, null, null, null, 0, null, null, '2026-10-22');
  perform estornar_movimento(v_fardo, null, 'fardo errado');
  perform registrar_movimento(99320, L, GELO, 'ENT', 'COMPRA', 'g3', 10, 4.00);
  assert (select cmc from estoque_custos where loja_id = 99320 and codigo_produto = GELO) > 20, 'antes: CMC inflado pelo fardo';
  r := reprocessar_custo(99320, array[GELO], '2026-10-20', 'teste fardo');
  -- S=10 a 3,79; venda 5 a 3,79; depois 10 a 4 → (5·3,79 + 40)/15 = 3,93
  assert (select cmc from estoque_custos where loja_id = 99320 and codigo_produto = GELO) = 3.93, 'CMC sem o fardo: ' || r::text;
  assert (select custo_unitario from estoque_movimentos_efetivo where loja_id = 99320 and ref = 'gv') = 3.79, 'a venda sai ao custo certo';
  assert (select custo_unitario from estoque_movimentos_efetivo where reverses_id = v_fardo) = 60, 'estorno vale o custo da entrada estornada';
  assert (select saldo_total from estoque_custos where loja_id = 99320 and codigo_produto = GELO) = 15, 'saldo = soma do ledger';
  -- estorno feito hoje com "desde" depois da entrada estornada: o reprocessamento recua até ela
  assert _recuo_pares(99320, array[GELO], (now() at time zone 'America/Sao_Paulo')::date, null) = '2026-10-21',
    'recuo mínimo calculado antes da cascata/trava = data da entrada estornada';
  assert _recuo_pares(99320, array[GELO], (now() at time zone 'America/Sao_Paulo')::date, '2026-11-01') = '2026-11-01', 'nunca antes do 1º dia aberto';
  r := reprocessar_custo(99320, array[GELO], (now() at time zone 'America/Sao_Paulo')::date, 'teste recuo');
  assert (r->>'movimentos_revisados')::int = 0, 'recuo até o par não muda nada: ' || r::text;
  assert (select cmc from estoque_custos where loja_id = 99320 and codigo_produto = GELO) = 3.93, 'CMC continua sem o fardo';

  ---------------------------------------------------------------------------------------------------------------
  -- 5) Mês fechado: nada antes do fechamento muda; o pedido começa no 1º dia aberto, com aviso (Review Focus 4)
  insert into estoque_periodo_fechado (loja_id, mes, fechado_por) values (99320, '2026-09-01', 'teste');
  r := reprocessar_custo(99320, array[COCA], '2026-09-15', 'teste fechado');
  assert r->>'desde_efetivo' = '2026-10-01', 'começa no 1º dia aberto: ' || r::text;
  assert exists (select 1 from jsonb_array_elements_text(r->'avisos') a where a like '%fechado%'), 'aviso do mês fechado';

  ---------------------------------------------------------------------------------------------------------------
  -- 6) Trava por loja × produto (Review Focus 5): os advisory locks ficam presos até o fim da transação
  select count(*) into n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
     and ((classid::bigint << 32) | objid::bigint) = hashtextextended(format('custo:%s:%s', 99320, COCA), 7311);
  assert n = 1, 'advisory lock do produto preso na transação: ' || n;

  -- 7) loja Omie recusada; soma das quantidades nunca muda
  begin
    perform reprocessar_custo(99321, array[COCA], '2026-10-01', 'omie');
    raise exception 'loja omie deveria falhar';
  exception when sqlstate '22023' then null;
  end;
  select sum(quantidade) into s from estoque_movimentos_efetivo where loja_id = 99320;
  assert s = (select sum(quantidade) from estoque_movimentos where loja_id = 99320), 'quantidades iguais';
  assert not has_function_privilege('authenticated', 'reprocessar_custo(bigint,bigint[],date,text)', 'execute'), 'authenticated não executa';
  raise notice '312 REPROCESSAR CUSTO OK';
end $$;
