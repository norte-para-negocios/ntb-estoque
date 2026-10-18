-- Teste da migration 180: nota cancelada na SEFAZ no estoque próprio. Cópia local com o esquema público de produção
-- (pg_dump --schema-only), nunca em produção.
do $$
declare v_loja bigint; r jsonb; s numeric; n int;
  chave_a text := '29261000000000000000550010000000011000000011';
  chave_b text := '29261000000000000000550010000000021000000022';
  item jsonb := '[{"linha":1,"c_prod":"X1","descricao":"ITEM TESTE","quantidade":10,"valor_unitario":5,"valor_total":50,"codigo_produto":"777"}]';
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 180', '00000000000000', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, 1, 'DEPOSITO');
  insert into produtos (loja_id, codigo_produto, codigo, descricao) values (v_loja, 777, 'P777', 'ITEM TESTE');

  -- A: compra lançada (saldo 10) → cancelamento estorna
  insert into notas_fiscais (loja_id, c_chave_nfe, c_etapa, full_object) values (v_loja, chave_a, '60', '{}');
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'chave_acesso', chave_a, 'numero', '1', 'itens', item), 1, null);
  if r->>'status' <> 'lancada' then raise exception 'A: compra não lançada: %', r; end if;
  select coalesce(sum(saldo), 0) into s from estoque_saldos where loja_id = v_loja and codigo_produto = 777;
  if s <> 10 then raise exception 'A: saldo antes = %', s; end if;
  r := sefaz_marcar_cancelada(v_loja, chave_a);
  if coalesce((r->>'estornada')::boolean, false) is not true then raise exception 'A: não estornou: %', r; end if;
  select coalesce(sum(saldo), 0) into s from estoque_saldos where loja_id = v_loja and codigo_produto = 777;
  if s <> 0 then raise exception 'A: saldo depois = %', s; end if;
  if (select status from compras_proprio where loja_id = v_loja and chave_acesso = chave_a) <> 'cancelada' then raise exception 'A: status'; end if;

  -- C: de novo → idempotente
  r := sefaz_marcar_cancelada(v_loja, chave_a);
  if coalesce((r->>'estornados')::int, 0) <> 0 then raise exception 'C: estornou de novo: %', r; end if;

  -- B: cancelamento chega antes da nota → lançar a mesma chave não entra
  r := sefaz_marcar_cancelada(v_loja, chave_b);
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'chave_acesso', chave_b, 'numero', '2', 'itens', item), 1, null);
  if r->>'status' <> 'cancelada' then raise exception 'B: lançou nota cancelada: %', r; end if;
  select count(*) into n from estoque_movimentos where loja_id = v_loja and ref = chave_b;
  if n <> 0 then raise exception 'B: % movimentos', n; end if;

  raise notice 'nf cancelada proprio (180) OK';
end $$;
