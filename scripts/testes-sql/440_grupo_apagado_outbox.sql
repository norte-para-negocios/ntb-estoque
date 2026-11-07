-- Teste da 440. CÓPIA ou BEGIN ... ROLLBACK; espera NOTICE "440 GRUPO APAGADO OK".
insert into lojas (id, cnpj, nome, ativo, modo_estoque, vendas_store_id) values (99440, '00000000099440', 'TESTE 440', true, 'proprio', gen_random_uuid());
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99441, '00000000099441', 'TESTE 440 sem Vendas', true, 'proprio');
do $$
declare g bigint; g2 bigint; n int; op text;
begin
  insert into grupos_produto (loja_id, nome) values (99440, 'Bebidas') returning id into g;
  update sync_outbox set status = 'ok' where loja_id = 99440;
  delete from grupos_produto where id = g;
  select count(*), max(operacao) into n, op from sync_outbox where loja_id = 99440 and entidade = 'grupo' and ref = g::text and status = 'pending';
  assert n = 1 and op = 'delete', 'grupo apagado entra como delete: ' || n || ' ' || coalesce(op, '-');
  -- criado e apagado antes da entrega: a mesma linha pendente vira delete
  insert into grupos_produto (loja_id, nome) values (99440, 'Doces') returning id into g2;
  delete from grupos_produto where id = g2;
  select count(*), max(operacao) into n, op from sync_outbox where loja_id = 99440 and ref = g2::text and status = 'pending';
  assert n = 1 and op = 'delete', 'criado e apagado = 1 pendente delete: ' || n || ' ' || coalesce(op, '-');
  -- loja sem Vendas: nada
  insert into grupos_produto (loja_id, nome) values (99441, 'X') returning id into g;
  delete from grupos_produto where id = g;
  select count(*) into n from sync_outbox where loja_id = 99441;
  assert n = 0, 'loja sem Vendas não gera outbox';
  raise notice '440 GRUPO APAGADO OK';
end $$;
