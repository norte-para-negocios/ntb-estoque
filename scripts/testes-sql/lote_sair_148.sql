-- Roda dentro de BEGIN ... ROLLBACK, depois da 148. Item sem lote nenhum sai e fica negativo sem erro.
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99148, '00000000099148', 'TESTE LOTE 148', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99148, 8000000009148, 'Geral', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99148, 8000000009149, '80001', 'Insumo nunca comprado', 'G', '01');
do $$
declare r jsonb; s numeric;
begin
  r := registrar_movimento(99148, 8000000009148, 8000000009149, 'SAI', 'VENDA', 'p-148', 50, null);
  assert (r->>'saldo')::numeric = -50, 'saldo negativo ' || r;
  select saldo into s from estoque_lotes where loja_id = 99148 and lote is null and validade is null;
  assert s = -50, 'lote sem lote negativo: ' || coalesce(s::text, 'null');
  assert (select count(*) from estoque_lote_movimentos where loja_id = 99148 and lote_id is not null) = 1, 'vinculo com lote';
  raise notice 'LOTE SAIR 148 OK';
end $$;
