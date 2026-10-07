-- Teste da transferência no modo proprio (migration 138). Roda dentro de BEGIN ... ROLLBACK.
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99020, '00000000099020', 'TESTE TRF', true, 'proprio');
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99021, '00000000099021', 'TESTE TRF OMIE', true, 'omie');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values
  (99020, 8000000002901, 'Geral', 'S'), (99020, 8000000002902, 'Bar', 'N');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99020, 8000000002801, '90001', 'Chopp', 'UN', '00');
insert into transferencias (id, loja_id, codigo_local_origem, codigo_local_destino, motivo, status, data)
  values (990201, 99020, 8000000002901, 8000000002902, 'TRF', 'Em contagem', now());
insert into movimentos (id, loja_id, transferencia_id, tipo, origem, motivo, data, id_prod, codigo_local_estoque, codigo_local_estoque_destino, status, quan)
  values (9902011, 99020, 990201, 'TRF', 'AJU', 'TRF', now(), 8000000002801, 8000000002901, 8000000002902, 'Iniciado', null);

do $$
declare r jsonb; sa numeric; sb numeric; c numeric; v int; st text; n int;
  A bigint := 8000000002901; B bigint := 8000000002902; P bigint := 8000000002801;
begin
  perform registrar_movimento(99020, A, P, 'ENT', 'TESTE', 'e1', 10, 5.00);

  -- sem quantidade: recusa
  begin
    perform lancar_transferencia_item(99020, 9902011, 'u');
    assert false, 'sem quantidade deveria falhar';
  exception when sqlstate '22023' then null; end;

  -- lança 4
  update movimentos set quan = 4 where id = 9902011;
  r := lancar_transferencia_item(99020, 9902011, 'u');
  select saldo into sa from estoque_saldos where loja_id=99020 and codigo_local_estoque=A and codigo_produto=P;
  select saldo into sb from estoque_saldos where loja_id=99020 and codigo_local_estoque=B and codigo_produto=P;
  select cmc into c from estoque_custos where loja_id=99020 and codigo_produto=P;
  select ledger_versao, status into v, st from movimentos where id=9902011;
  assert sa = 6 and sb = 4, 'saldos apos lancar ' || sa || '/' || sb;
  assert c = 5, 'custo inalterado ' || c;
  assert v = 1 and st = 'Concluido', 'versao/status ' || v || '/' || st;

  -- mexe na quantidade (4 -> 3): estorna e relança
  update movimentos set quan = 3 where id = 9902011;
  r := lancar_transferencia_item(99020, 9902011, 'u');
  select saldo into sa from estoque_saldos where loja_id=99020 and codigo_local_estoque=A and codigo_produto=P;
  select saldo into sb from estoque_saldos where loja_id=99020 and codigo_local_estoque=B and codigo_produto=P;
  select cmc into c from estoque_custos where loja_id=99020 and codigo_produto=P;
  select ledger_versao into v from movimentos where id=9902011;
  assert sa = 7 and sb = 3, 'saldos apos editar ' || sa || '/' || sb;
  assert c = 5 and v = 2, 'custo/versao apos editar ' || c || '/' || v;

  -- o ledger nunca é alterado: 2 pernas v1 + 2 estornos + 2 pernas v2 = 6 linhas de transferência/estorno
  select count(*) into n from estoque_movimentos where loja_id=99020 and tipo in ('TRF');
  assert n = 6, 'linhas TRF no ledger ' || n;
  select count(*) into n from estoque_movimentos where loja_id=99020 and tipo = 'EST';
  assert n = 0, 'estorno de perna de transferencia nao vira EST';

  -- reenvio igual (mesma versão) nao duplica: relançar sem mudar a quantidade estorna e relança igual => saldo igual
  r := lancar_transferencia_item(99020, 9902011, 'u');
  select saldo into sa from estoque_saldos where loja_id=99020 and codigo_local_estoque=A and codigo_produto=P;
  assert sa = 7, 'relancar igual mantem saldo ' || sa;

  -- desfazer
  r := estornar_transferencia_item(99020, 9902011, 'u');
  select saldo into sa from estoque_saldos where loja_id=99020 and codigo_local_estoque=A and codigo_produto=P;
  select saldo into sb from estoque_saldos where loja_id=99020 and codigo_local_estoque=B and codigo_produto=P;
  select status into st from movimentos where id=9902011;
  assert sa = 10 and sb = 0, 'saldos apos desfazer ' || sa || '/' || sb;
  assert st = 'Iniciado', 'status apos desfazer ' || st;
  -- desfazer de novo é inofensivo
  r := estornar_transferencia_item(99020, 9902011, 'u');
  assert (r->>'estornados')::int = 0, 'desfazer repetido';

  -- saldo negativo na origem é permitido (restaurante transfere antes de lançar a compra)
  update movimentos set quan = 25 where id = 9902011;
  r := lancar_transferencia_item(99020, 9902011, 'u');
  select saldo into sa from estoque_saldos where loja_id=99020 and codigo_local_estoque=A and codigo_produto=P;
  assert sa = -15, 'negativo permitido ' || sa;

  -- origem = destino recusa
  update movimentos set codigo_local_estoque_destino = A, quan = 1, ledger_ref = null where id = 9902011;
  begin
    perform lancar_transferencia_item(99020, 9902011, 'u');
    assert false, 'origem=destino deveria falhar';
  exception when sqlstate '22023' then null; end;

  -- loja omie recusa
  begin
    perform lancar_transferencia_item(99021, 9902011, 'u');
    assert false, 'loja omie deveria recusar';
  exception when sqlstate '22023' then null; end;
  begin
    perform estornar_transferencia_item(99021, 9902011, 'u');
    assert false, 'loja omie deveria recusar (estorno)';
  exception when sqlstate '22023' then null; end;

  raise notice 'TRANSFERENCIA OK';
end $$;
