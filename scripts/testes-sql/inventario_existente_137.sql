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
  -- espelho diario: entrada 10 no dia; as saidas/estorno do inventario netam (-2 estornado, -1 lancado)
  select entradas into s from movimentos_historico where loja_id=99020 and cod_prod=8000000002801;
  assert s = 10, 'historico entradas ' || s;
  select saidas into s from movimentos_historico where loja_id=99020 and cod_prod=8000000002801;
  assert s = 1, 'historico saidas liquidas ' || s;
  perform 1 from information_schema.columns where table_name='inventario_items' and column_name in ('motivo','diferenca');
  assert found, 'colunas novas';
  -- kardex: total, busca livre, origem agrupada, so estornos e paginacao
  r := kardex_proprio(99020, null, null, null, null, null, null, null, null, false, false, 'data', 'desc', 50, 0);
  assert (r->>'total')::int = 4, 'kardex total ' || (r->>'total');
  r := kardex_proprio(99020, null, null, 'Chopp', null, null, null, null, null, false, false, 'data', 'asc', 2, 0);
  assert jsonb_array_length(r->'linhas') = 2 and (r->>'total')::int = 4, 'kardex texto/paginacao';
  r := kardex_proprio(99020, null, null, 'inv:1:r1', null, null, null, null, null, false, false, 'data', 'desc', 50, 0);
  assert (r->>'total')::int = 1 and (r->'linhas'->0->>'estornado_por') is not null, 'kardex ref e estornado_por';
  r := kardex_proprio(99020, null, null, null, null, null, null, null, null, false, true, 'data', 'desc', 50, 0);
  assert (r->>'total')::int = 2, 'kardex so estornos ' || (r->>'total');
  r := kardex_proprio(99020, null, null, null, null, 'INVENTARIO', null, null, null, false, false, 'quantidade', 'asc', 50, 0);
  assert (r->>'total')::int = 2, 'kardex origem inventario';
  raise notice 'INV137 OK';
end $$;
