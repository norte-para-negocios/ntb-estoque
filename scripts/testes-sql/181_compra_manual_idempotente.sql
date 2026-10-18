-- Teste da migration 181: compra manual com chave de idempotência (duplo clique / reenvio do desktop). Cópia local
-- com o esquema público de produção + 180 + 181. Nunca em produção.
do $$
declare v_loja bigint; r1 jsonb; r2 jsonb; n int; s numeric;
  compra jsonb;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 181', '00000000000000', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, 1, 'DEPOSITO');
  insert into produtos (loja_id, codigo_produto, codigo, descricao) values (v_loja, 888, 'P888', 'ITEM MANUAL');
  compra := jsonb_build_object('loja_id', v_loja, 'origem', 'manual', 'chave_idempotencia', '3f6c2a9e-1b7d-4c55-9a0e-2d8f4b6c1e07',
    'itens', '[{"linha":1,"quantidade":4,"valor_unitario":10,"valor_total":40,"codigo_produto":"888"}]'::jsonb);
  r1 := lancar_compra_com_lotes(compra, 1, null);
  r2 := lancar_compra_com_lotes(compra, 1, null);
  select count(*) into n from compras_proprio where loja_id = v_loja;
  if n <> 1 then raise exception 'compras: % (esperado 1)', n; end if;
  select coalesce(sum(saldo), 0) into s from estoque_saldos where loja_id = v_loja and codigo_produto = 888;
  if s <> 4 then raise exception 'saldo: % (esperado 4)', s; end if;
  if coalesce((r2->>'duplicado')::boolean, false) is not true then raise exception '2ª chamada sem duplicado: %', r2; end if;
  if (r2->>'compra_id') <> (r1->>'compra_id') then raise exception 'compra diferente: % × %', r1, r2; end if;
  raise notice 'compra manual idempotente (181) OK';
end $$;
