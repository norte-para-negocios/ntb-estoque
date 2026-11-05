-- Teste da migration 321 (sugestão de compra do estoque próprio: mínimo do produto e devolução fora do consumo).
-- Roda contra o banco com a 317 aplicada, sempre dentro de transação desfeita. Da raiz do repositório:
--   psql -v ON_ERROR_STOP=1 -c begin -c "select set_config('t321.fase', 'antes', false)" -f scripts/testes-sql/321_sugestao_minimo_devolucao.sql \
--        -f supabase/migrations/321_sugestao_minimo_devolucao.sql -c "select set_config('t321.fase', 'depois', false)" \
--        -f scripts/testes-sql/321_sugestao_minimo_devolucao.sql -c rollback
-- Espera: "321 ANTES: bug presente" (sem a 321) e NOTICE "321 SUGESTAO MINIMO/DEVOLUCAO OK" (com a 321).
do $$
declare L bigint := 8000000032101; r jsonb; a jsonb; b jsonb; c jsonb; fase text := current_setting('t321.fase');
begin
  if fase = 'antes' then
    insert into lojas (id, cnpj, nome, ativo, modo_estoque, is_test) values (99321, '00000000099321', 'TESTE 321', true, 'proprio', true);
    insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99321, 8000000032101, 'Estoque', 'S');
    insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, estoque_minimo) values
      (99321, 8000000032111, '32111', 'Só mínimo do cadastro', 'UN', '00', 10),
      (99321, 8000000032112, '32112', 'Mínimo por local vence o do cadastro', 'UN', '00', 99),
      (99321, 8000000032113, '32113', 'Venda e devolução', 'UN', '00', null);
    insert into estoque_saldos (loja_id, codigo_local_estoque, codigo_produto, saldo, minimo) values (99321, L, 8000000032112, 0, 5);
    perform registrar_movimento(99321, L, 8000000032113, 'ENT', 'COMPRA', 't321:1', 10, 2, null, null, 0, null, null, current_date - 2);
    perform registrar_movimento(99321, L, 8000000032113, 'SAI', 'VENDA', 't321:2', -3, null, null, null, 0, null, null, current_date - 1);
    perform registrar_movimento(99321, L, 8000000032113, 'SAI', 'DEVOLUCAO_FORNECEDOR', 't321:3', -2, null, null, null, 0, null, null, current_date - 1);
  end if;
  r := sugestao_compra_proprio(99321, current_date - 5, current_date, current_date, current_date + 10);
  select x into a from jsonb_array_elements(r) x where (x->>'codigo_produto')::bigint = 8000000032111;
  select x into b from jsonb_array_elements(r) x where (x->>'codigo_produto')::bigint = 8000000032112;
  select x into c from jsonb_array_elements(r) x where (x->>'codigo_produto')::bigint = 8000000032113;
  raise notice '321 %: so_cadastro=% por_local=% consumo=%', upper(fase), a->>'estoque_minimo', b->>'estoque_minimo', c->>'consumo_total';
  if fase = 'antes' then
    -- sem a 321: o produto só com mínimo do cadastro some e a devolução entra no consumo (3 + 2)
    if a is not null or (c->>'consumo_total')::numeric <> 5 then raise exception '321 ANTES: esperava o bug (sumir e consumo 5)'; end if;
    raise notice '321 ANTES: bug presente';
  else
    if a is null or (a->>'estoque_minimo')::numeric <> 10 then raise exception '321: mínimo do cadastro não entrou (%).', a; end if;
    if (b->>'estoque_minimo')::numeric <> 5 then raise exception '321: mínimo por local devia valer 5, veio %', b->>'estoque_minimo'; end if;
    if (c->>'consumo_total')::numeric <> 3 then raise exception '321: consumo devia ser 3 (só a venda), veio %', c->>'consumo_total'; end if;
    if (c->>'estoque_atual')::numeric <> 5 then raise exception '321: saldo devia ser 5, veio %', c->>'estoque_atual'; end if;
    raise notice '321 SUGESTAO MINIMO/DEVOLUCAO OK';
  end if;
end $$;
