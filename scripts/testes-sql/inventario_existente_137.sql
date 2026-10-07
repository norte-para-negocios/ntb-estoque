-- Confere as colunas novas e que o ajuste de inventário (AJU) por item funciona no ledger (BEGIN ... ROLLBACK).
do $$
declare r jsonb; s numeric;
begin
  insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99020, '00000000099020', 'TESTE INV137', true, 'proprio');
  insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99020, 8000000002901, 'Geral', 'S');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99020, 8000000002801, '90001', 'Chopp', 'UN', '00');
  r := registrar_movimento(99020, 8000000002901, 8000000002801, 'ENT', 'TESTE', 'e1', 10, 5);
  -- contou 8: delta -2
  r := registrar_movimento(99020, 8000000002901, 8000000002801, 'AJU', 'INVENTARIO', 'inv:1:r1', -2, null, 'u', 'Inventário #1');
  assert (r->>'saldo')::numeric = 8, 'delta -2 deixa 8 ' || r;
  -- refez para 9: estorna o anterior e lança +1
  perform estornar_movimento((r->>'id')::bigint);
  r := registrar_movimento(99020, 8000000002901, 8000000002801, 'AJU', 'INVENTARIO', 'inv:1:r2', -1, null, 'u', 'Inventário #1');
  select saldo into s from estoque_saldos where loja_id=99020 and codigo_produto=8000000002801;
  assert s = 9, 'saldo final 9 ' || s;
  perform 1 from information_schema.columns where table_name='inventario_items' and column_name in ('motivo','diferenca');
  assert found, 'colunas novas';
  raise notice 'INV137 OK';
end $$;
