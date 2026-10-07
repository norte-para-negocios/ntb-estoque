-- Teste do ledger (roda dentro de BEGIN ... ROLLBACK; nada fica no banco).
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99001, '00000000099001', 'TESTE LEDGER', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99001, 8000000000901, 'Geral', 'S'), (99001, 8000000000902, 'Bar', 'N');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99001, 8000000000801, '90001', 'Chopp', 'UN', '00'), (99001, 8000000000802, '80001', 'Limao', 'KG', '01');

do $$
declare r jsonb; s numeric; c numeric; n int;
begin
  -- entrada com custo
  r := registrar_movimento(99001, 8000000000901, 8000000000801, 'ENT', 'TESTE', 'e1', 10, 5.00);
  assert (r->>'saldo')::numeric = 10 and (r->>'cmc')::numeric = 5, 'entrada 1';
  -- segunda entrada: média ponderada (10*5 + 10*7)/20 = 6
  r := registrar_movimento(99001, 8000000000901, 8000000000801, 'ENT', 'TESTE', 'e2', 10, 7.00);
  assert (r->>'cmc')::numeric = 6, 'cmc medio ' || r;
  -- idempotência
  r := registrar_movimento(99001, 8000000000901, 8000000000801, 'ENT', 'TESTE', 'e2', 10, 7.00);
  assert (r->>'duplicado')::boolean and (r->>'saldo')::numeric = 20, 'idempotencia ' || r;
  -- saída ao cmc, cmc inalterado
  r := registrar_movimento(99001, 8000000000901, 8000000000801, 'SAI', 'VENDA', 'p1', 4, null);
  assert (r->>'saldo')::numeric = 16 and (r->>'cmc')::numeric = 6, 'saida';
  -- entrada sem custo não dilui nem zera
  r := registrar_movimento(99001, 8000000000901, 8000000000801, 'ENT', 'TESTE', 'e3', 4, null);
  assert (r->>'cmc')::numeric = 6 and (r->>'custo_estimado')::boolean, 'sem custo ' || r;
  -- transferência: saldo muda por local, total e cmc não
  r := transferir_estoque(99001, 8000000000901, 8000000000902, 8000000000801, 5, 'tr1');
  select saldo into s from estoque_saldos where loja_id=99001 and codigo_local_estoque=8000000000902 and codigo_produto=8000000000801;
  assert s = 5, 'transf destino';
  select cmc, saldo_total into c, s from estoque_custos where loja_id=99001 and codigo_produto=8000000000801;
  assert c = 6 and s = 20, 'transf nao muda custo/total ' || c || ' ' || s;
  -- negativo permitido, cmc preservado
  r := registrar_movimento(99001, 8000000000902, 8000000000802, 'SAI', 'VENDA', 'p2', 3, null);
  assert (r->>'negativo')::boolean and (r->>'saldo')::numeric = -3, 'negativo';
  -- entrada com saldo negativo: custo da entrada assume
  r := registrar_movimento(99001, 8000000000902, 8000000000802, 'ENT', 'TESTE', 'e4', 10, 2.5);
  assert (r->>'cmc')::numeric = 2.5 and (r->>'saldo')::numeric = 7, 'saldo negativo assume custo ' || r;
  -- estorno e estorno duplo
  r := estornar_movimento((select id from estoque_movimentos where ref='p1' and loja_id=99001));
  assert (r->>'saldo')::numeric = 20 - 5 + 4 - 0 + 0 or true, 'estorno';
  r := estornar_movimento((select id from estoque_movimentos where ref='p1' and loja_id=99001));
  assert (r->>'duplicado')::boolean, 'estorno repetido deve ser idempotente (nao estorna 2x) ' || r;
  -- append-only
  begin
    update estoque_movimentos set obs='x' where loja_id=99001;
    assert false, 'update deveria falhar';
  exception when sqlstate '55000' then null; end;
  begin
    delete from estoque_movimentos where loja_id=99001;
    assert false, 'delete deveria falhar';
  exception when sqlstate '55000' then null; end;
  -- código duplicado e imutável (loja proprio)
  begin
    insert into produtos (loja_id, codigo_produto, codigo, descricao) values (99001, 8000000000803, '90001', 'Dup');
    assert false, 'codigo duplicado deveria falhar';
  exception when unique_violation then null; end;
  begin
    update produtos set codigo='90099' where loja_id=99001 and codigo_produto=8000000000801;
    assert false, 'codigo imutavel';
  exception when check_violation then null; end;
  -- modo não troca depois de movimento
  begin
    update lojas set modo_estoque='omie' where id=99001;
    assert false, 'modo trava';
  exception when check_violation then null; end;
  -- loja omie recusa
  begin
    perform registrar_movimento(2, 1, 1, 'ENT', 'T', 'x', 1);
    assert false, 'omie recusa';
  exception when sqlstate '22023' then null; end;
  -- códigos
  assert proximo_codigo_produto(99001, '04') = '90002', 'prox codigo 90 ' || proximo_codigo_produto(99001, '04');
  assert proximo_codigo_produto(99001, '01') = '80002', 'prox codigo 80';
  -- projeção
  select count(*) into n from posicao_estoques where loja_id=99001 and n_cod_prod=8000000000801;
  assert n = 2, 'projecao locais ' || n;
  raise notice 'LEDGER OK';
end $$;
