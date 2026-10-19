-- Teste da migration 231 (devolução ao fornecedor, sem NF-e). Banco LOCAL (230_preparar_banco.sh), nunca produção.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d f1 < scripts/testes-sql/231_devolucao_fornecedor.sql
begin;
do $$
declare
  v_loja bigint; v_omie bigint; r jsonb; v_a bigint; v_b bigint; v_item_b bigint; v_dev bigint; c estoque_custos%rowtype; v_saldo numeric; n int; e text;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 231', '00000000000231', 'proprio') returning id into v_loja;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 231 OMIE', '00000000000232', 'omie') returning id into v_omie;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (v_loja, 1, 'DEPOSITO', 'S');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (v_loja, 501, 'P501', 'TOMATE', 'UN');

  -- duas compras: 10 UN a R$ 10 e 10 UN a R$ 20 → CMC 15
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'origem', 'manual', 'numero', '100', 'fornecedor_nome', 'HORTI',
        'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'descricao', 'TOMATE', 'quantidade', 10, 'valor_unitario', 10, 'valor_total', 100, 'fator', 1, 'codigo_produto', 501))), 1, 'u1');
  v_a := (r->>'compra_id')::bigint;
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'origem', 'manual', 'numero', '200', 'fornecedor_nome', 'HORTI',
        'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'descricao', 'TOMATE', 'quantidade', 10, 'valor_unitario', 20, 'valor_total', 200, 'fator', 1, 'codigo_produto', 501))), 1, 'u1');
  v_b := (r->>'compra_id')::bigint;
  select * into c from estoque_custos where loja_id = v_loja and codigo_produto = 501;
  if c.cmc <> 15 or c.saldo_total <> 20 then raise exception 'preparação: cmc % saldo %', c.cmc, c.saldo_total; end if;
  select id into v_item_b from compras_proprio_itens where compra_id = v_b;

  -- 1. loja Omie recusa
  begin perform devolucao_fornecedor_registrar(v_omie, v_b, '[{"compra_item_id":1,"quantidade":1}]'::jsonb, 'x'); raise exception 'omie devolveu';
  exception when sqlstate '22023' then null; end;
  -- 2. sem motivo recusa
  begin perform devolucao_fornecedor_registrar(v_loja, v_b, jsonb_build_array(jsonb_build_object('compra_item_id', v_item_b, 'quantidade', 1)), ' '); raise exception 'sem motivo';
  exception when sqlstate '22023' then null; end;

  -- 3. devolve 5 da 2ª: sai a R$ 20, CMC (20·15 − 5·20)/15 = 13,333333 (HIPÓTESE R9), situação a_emitir
  r := devolucao_fornecedor_registrar(v_loja, v_b, jsonb_build_array(jsonb_build_object('compra_item_id', v_item_b, 'quantidade', 5, 'cfop', '5.202')),
        'tomate estragado', 'u1', 'Ana', 'dev-1');
  v_dev := (r->>'id')::bigint;
  if (r->>'numero')::int <> 1 or (r->>'valor_custo')::numeric <> 100 or (r->>'valor_fiscal')::numeric <> 100 then raise exception 'registrar %', r; end if;
  select * into c from estoque_custos where loja_id = v_loja and codigo_produto = 501;
  if c.cmc <> 13.333333 or c.saldo_total <> 15 then raise exception 'cmc depois da devolução % saldo %', c.cmc, c.saldo_total; end if;
  select saldo into v_saldo from estoque_saldos where loja_id = v_loja and codigo_local_estoque = 1 and codigo_produto = 501;
  if v_saldo <> 15 then raise exception 'saldo do local %', v_saldo; end if;
  if (select situacao from devolucoes_fornecedor where id = v_dev) <> 'a_emitir' then raise exception 'situação'; end if;
  if (select custo_unitario from estoque_movimentos where origem = 'DEVOLUCAO_FORNECEDOR' and loja_id = v_loja) <> 20 then raise exception 'custo da saída'; end if;

  -- 4. mesma chave não duplica
  r := devolucao_fornecedor_registrar(v_loja, v_b, jsonb_build_array(jsonb_build_object('compra_item_id', v_item_b, 'quantidade', 5)), 'x', 'u1', 'Ana', 'dev-1');
  if (r->>'duplicado')::boolean is not true or (r->>'id')::bigint <> v_dev then raise exception 'idempotência %', r; end if;

  -- 5. quantidade acima do devolvível recusa (sobraram 5)
  begin
    perform devolucao_fornecedor_registrar(v_loja, v_b, jsonb_build_array(jsonb_build_object('compra_item_id', v_item_b, 'quantidade', 6)), 'mais', 'u1', 'Ana');
    raise exception 'devolveu acima';
  exception when sqlstate '22023' then
    get stacked diagnostics e = message_text;
    if e not like '%ainda dá para devolver (5.000000)%' then raise exception 'mensagem: %', e; end if;
  end;
  -- item de outra nota recusa
  begin
    perform devolucao_fornecedor_registrar(v_loja, v_a, jsonb_build_array(jsonb_build_object('compra_item_id', v_item_b, 'quantidade', 1)), 'x');
    raise exception 'item de outra nota';
  exception when sqlstate '22023' then null; end;

  -- 6. desfazer a entrada com devolução ativa recusa
  begin perform estornar_compra(v_b, 'u1'); raise exception 'estornou com devolução'; exception when sqlstate '22023' then null; end;

  -- 7. cancelar: saldo volta a 20 e o custo médio a 15
  r := devolucao_fornecedor_cancelar(v_loja, v_dev, 'u2', 'Dono', 'fornecedor não aceitou');
  if (r->>'estornados')::int <> 1 then raise exception 'cancelar %', r; end if;
  select * into c from estoque_custos where loja_id = v_loja and codigo_produto = 501;
  if c.saldo_total <> 20 or abs(c.cmc - 15) > 0.000001 then raise exception 'depois de cancelar cmc % saldo %', c.cmc, c.saldo_total; end if;
  r := devolucao_fornecedor_cancelar(v_loja, v_dev, 'u2', 'Dono');
  if (r->>'duplicado')::boolean is not true then raise exception 'cancelar 2x %', r; end if;
  select count(*) into n from devolucoes_fornecedor_eventos where devolucao_id = v_dev;
  if n <> 2 then raise exception 'eventos %', n; end if;
  -- cancelada não conta: dá para devolver 10 de novo; e agora o estorno da compra passa
  r := devolucao_fornecedor_registrar(v_loja, v_b, jsonb_build_array(jsonb_build_object('compra_item_id', v_item_b, 'quantidade', 10)), 'tudo', 'u1', 'Ana');
  if (r->>'numero')::int <> 2 then raise exception 'número 2 %', r; end if;
  perform devolucao_fornecedor_cancelar(v_loja, (r->>'id')::bigint, 'u1', 'Ana');
  perform estornar_compra(v_b, 'u1');

  -- 8. cancelamento na SEFAZ de nota com devolução ativa (revisão I2): não volta atrás inteiro; a chave fica gravada
  --    como cancelada, a compra ganha evento 'cancelada' com estorno_pendente e a devolução continua de pé
  update compras_proprio set chave_acesso = repeat('7', 44) where id = v_a;
  select id into v_item_b from compras_proprio_itens where compra_id = v_a;
  r := devolucao_fornecedor_registrar(v_loja, v_a, jsonb_build_array(jsonb_build_object('compra_item_id', v_item_b, 'quantidade', 2)), 'avariado', 'u1', 'Ana');
  r := sefaz_marcar_cancelada(v_loja, repeat('7', 44));
  if (r->>'estornada')::boolean or (r->>'estorno_pendente')::boolean is not true then raise exception 'cancelada com devolução %', r; end if;
  if not exists (select 1 from sefaz_chaves_canceladas where loja_id = v_loja and chave = repeat('7', 44)) then raise exception 'chave cancelada não gravada'; end if;
  if not exists (select 1 from compras_proprio_eventos where compra_id = v_a and tipo = 'cancelada' and (detalhe->>'estorno_pendente')::boolean
                 and detalhe->>'motivo' like '%devolução ao fornecedor%') then raise exception 'evento estorno_pendente'; end if;
  if (select situacao from devolucoes_fornecedor where compra_id = v_a) <> 'a_emitir' then raise exception 'devolução mexida'; end if;

  raise notice '231: todos os testes passaram';
end $$;
do $$ begin
  if has_function_privilege('authenticated', 'public.devolucao_fornecedor_registrar(bigint,bigint,jsonb,text,text,text,text)', 'execute') then raise exception 'authenticated registra'; end if;
  if has_table_privilege('anon', 'public.devolucoes_fornecedor', 'select') then raise exception 'anon lê'; end if;
  raise notice '231: grants ok';
end $$;
rollback;
