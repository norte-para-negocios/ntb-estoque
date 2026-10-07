-- Teste do inventário próprio (rodar dentro de BEGIN ... ROLLBACK, depois de aplicar 132 e 134 na mesma transação).
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99003, '00000000099003', 'TESTE INV', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99003, 8000000000921, 'Geral', 'S');
insert into familias (loja_id, codigo_familia, nome) values (99003, 8000000000701, 'Bebidas');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, codigo_familia) values
  (99003, 8000000000821, '90001', 'Chopp', 'UN', '00', 8000000000701),
  (99003, 8000000000822, '90002', 'Vodka', 'UN', '00', 8000000000701),
  (99003, 8000000000823, '80001', 'Limao', 'KG', '01', 8000000000701);
alter table estoque_movimentos disable trigger estoque_movimentos_imutavel;  -- só no teste, para simular horários

do $$
declare r jsonb; inv bigint; s numeric; v record; t0 timestamptz := now() - interval '2 hours'; n int;
begin
  perform registrar_movimento(99003, 8000000000921, 8000000000821, 'ENT', 'T', 'e1', 10, 5.00);   -- chopp 10 @5
  perform registrar_movimento(99003, 8000000000921, 8000000000822, 'ENT', 'T', 'e2', 20, 50.00);  -- vodka 20 @50
  perform registrar_movimento(99003, 8000000000921, 8000000000823, 'ENT', 'T', 'e3', 4, 8.00);    -- limão 4 @8
  update estoque_movimentos set created_at = t0 where loja_id = 99003;

  -- abrir: 3 itens, só um aberto por local
  r := abrir_inventario(99003, 8000000000921, 'u1');
  inv := (r->>'id')::bigint;
  assert (r->>'itens')::int = 3, 'itens ' || r;
  begin perform abrir_inventario(99003, 8000000000921, 'u1'); assert false, 'segundo aberto';
  exception when unique_violation then null; end;

  -- contagem: chopp contado 8 às T0+30min (faltam 2); depois, às T0+60min, vendem 2 (venda DURANTE a contagem)
  perform contar_item(inv, 8000000000821, 8, 'u1', null, t0 + interval '30 minutes');
  perform registrar_movimento(99003, 8000000000921, 8000000000821, 'SAI', 'VENDA', 'p1', 2, null);
  update estoque_movimentos set created_at = t0 + interval '60 minutes' where loja_id = 99003 and ref = 'p1';
  -- vodka contada 20 (igual), limão contado 3 (falta 1 x 8 = 8 reais, abaixo do limite 50)
  perform contar_item(inv, 8000000000822, 20, 'u1', null, t0 + interval '40 minutes');
  perform contar_item(inv, 8000000000823, 3, 'u1', null, t0 + interval '41 minutes');
  -- item fora da lista: produto com saldo 0 achado na prateleira
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99003, 8000000000824, '90003', 'Gin', 'UN', '00');
  perform contar_item(inv, 8000000000824, 6, 'u1', null, t0 + interval '45 minutes');  -- sistema 0 -> sobra 6, custo 0 -> valor 0

  select * into v from inventario_variancia(inv) where codigo_produto = 8000000000821;
  assert v.esperado = 10 and v.contado = 8 and v.delta = -2, 'variancia chopp (venda durante nao contamina) ' || v::text;
  select * into v from inventario_variancia(inv) where codigo_produto = 8000000000822;
  assert v.delta = 0, 'vodka sem diferenca';

  -- motivo obrigatório quando |delta|*cmc > limite: sobe o limite para ser testado: chopp -2*5 = 10 -> reduz limite a 5
  insert into estoque_config (loja_id, limite_motivo_inventario) values (99003, 5.00);
  begin perform fechar_inventario(inv, 'u1'); assert false, 'deveria exigir motivo';
  exception when check_violation then null; end;
  perform motivo_item_inventario(inv, 8000000000821, 'quebra no balcão');
  perform motivo_item_inventario(inv, 8000000000823, 'vazamento');

  r := fechar_inventario(inv, 'u2');
  assert (r->>'ajustes')::int = 3 and not (r->>'duplicado')::boolean, 'fechar ' || r;  -- chopp, limão e gin
  -- chopp: 10 - 2 (venda) - 2 (ajuste) = 6 = o físico real agora
  select saldo into s from estoque_saldos where loja_id = 99003 and codigo_produto = 8000000000821;
  assert s = 6, 'saldo chopp ' || s;
  select saldo into s from estoque_saldos where loja_id = 99003 and codigo_produto = 8000000000824;
  assert s = 6, 'gin achado';
  -- cmc intacto pelo ajuste
  assert (select cmc from estoque_custos where loja_id = 99003 and codigo_produto = 8000000000821) = 5, 'cmc intacto';

  -- idempotente: fechar de novo não ajusta de novo
  r := fechar_inventario(inv, 'u2');
  assert (r->>'duplicado')::boolean, 'idempotente';
  select saldo into s from estoque_saldos where loja_id = 99003 and codigo_produto = 8000000000821;
  assert s = 6, 'saldo nao mudou no 2o fechar';
  begin perform contar_item(inv, 8000000000821, 1, 'u1'); assert false, 'fechado nao conta';
  exception when sqlstate '55000' then null; end;

  -- novo inventário aberto no mesmo local depois de fechar
  r := abrir_inventario(99003, 8000000000921, 'u1');
  perform cancelar_inventario((r->>'id')::bigint, 'u1');

  -- curva ABC: vodka vendida muito, chopp pouco
  perform registrar_movimento(99003, 8000000000921, 8000000000822, 'SAI', 'VENDA', 'p2', 10, null);
  select count(*) into n from curva_abc(99003) where classe = 'A';
  assert n >= 1, 'abc A';
  assert (select classe from curva_abc(99003) where codigo_produto = 8000000000822) = 'A', 'vodka classe A';
  assert (select classe from curva_abc(99003) where codigo_produto = 8000000000824) = 'C', 'sem giro = C';

  -- contagem cíclica só com a classe
  r := abrir_inventario(99003, 8000000000921, 'u1', 'ciclica', 'A');
  assert (r->>'itens')::int >= 1 and (r->>'itens')::int < 4, 'ciclica filtra por classe ' || r;
  perform cancelar_inventario((r->>'id')::bigint);

  -- sugestão de compra: mínimo - saldo
  insert into estoque_saldos (loja_id, codigo_local_estoque, codigo_produto, saldo, minimo) values (99003, 8000000000921, 8000000000823, 3, 10)
    on conflict (loja_id, codigo_local_estoque, codigo_produto) do update set minimo = 10;
  select falta, familia into v from sugestao_compra where loja_id = 99003 and codigo_produto = 8000000000823;
  assert v.falta = 7 and v.familia = 'Bebidas', 'sugestao ' || v::text;

  -- contagem cega: authenticated não lê saldo_snapshot
  begin
    set local role authenticated;
    perform saldo_snapshot from inventario_proprio_itens limit 1;
    assert false, 'saldo_snapshot nao pode ser lido';
  exception when insufficient_privilege then null; end;
  reset role;

  raise notice 'INVENTARIO OK';
end $$;
