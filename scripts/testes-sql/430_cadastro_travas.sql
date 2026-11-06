-- Teste da 430 (rodar dentro de BEGIN … ROLLBACK, depois da migration). Espera: NOTICE "430 TRAVAS OK".
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99430, '00000000099430', 'TESTE 430', true, 'proprio'), (99431, '00000000099431', 'TESTE 430 OMIE', true, 'omie');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99430, 8000000043001, 'Cozinha', 'S');
do $$
declare v_cod text; ok boolean;
begin
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
    (99430, 8000000043011, '80901', 'Farinha 430', 'KG', '01'),
    (99430, 8000000043012, '80902', 'Sal 430', 'KG', '01'),
    (99430, 8000000043013, '80903', 'Sem unidade 430', null, '01');
  assert (select count(*) from produto_codigos_usados where loja_id = 99430) = 3, 'códigos reservados na criação';

  -- unidade: sem movimento muda livre
  update produtos set unidade = 'G' where loja_id = 99430 and codigo_produto = 8000000043012;
  -- com movimento: bloqueia
  perform registrar_movimento(99430, 8000000043001, 8000000043011, 'ENT', 'COMPRA', 'c430', 5, 3.00);
  ok := false;
  begin update produtos set unidade = 'G' where loja_id = 99430 and codigo_produto = 8000000043011;
  exception when check_violation then ok := true; end;
  assert ok, 'unidade com movimento deveria travar';
  -- mesma unidade e outros campos continuam livres
  update produtos set unidade = 'KG', descricao = 'Farinha de trigo 430' where loja_id = 99430 and codigo_produto = 8000000043011;
  -- unidade vazia pode ser preenchida mesmo com movimento
  perform registrar_movimento(99430, 8000000043001, 8000000043013, 'ENT', 'COMPRA', 'c430b', 1, 1.00);
  update produtos set unidade = 'UN' where loja_id = 99430 and codigo_produto = 8000000043013;

  -- código: apagar e recriar OUTRO produto com o mesmo código é bloqueado
  delete from produtos where loja_id = 99430 and codigo_produto = 8000000043012;
  ok := false;
  begin insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99430, 8000000043099, '80902', 'Outro 430', 'UN', '01');
  exception when unique_violation then ok := true; end;
  assert ok, 'código reaproveitado deveria travar';
  -- o MESMO produto pode voltar com o próprio código
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99430, 8000000043012, '80902', 'Sal 430', 'KG', '01');

  -- próximo código pula o reservado
  insert into estoque_codigo_seq (loja_id, prefixo, ultimo) values (99430, '80', 900) on conflict (loja_id, prefixo) do update set ultimo = 900;
  delete from produtos where loja_id = 99430 and codigo = '80903' and false; -- (80903 continua existindo)
  v_cod := proximo_codigo_produto(99430, '01');
  assert v_cod = '80904', 'próximo código pula 80901-80903: ' || v_cod;

  -- loja omie: nada muda
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99431, 8000000043111, 'X1', 'Omie 430', 'KG', '01');
  insert into estoque_movimentos (loja_id, codigo_local_estoque, codigo_produto, tipo, origem, ref, quantidade)
    select 99431, 1, 8000000043111, 'ENT', 'COMPRA', 'o430', 1 where false; -- (omie não usa o ledger; a trava nem consulta)
  update produtos set unidade = 'UN' where loja_id = 99431 and codigo_produto = 8000000043111;
  delete from produtos where loja_id = 99431 and codigo_produto = 8000000043111;
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99431, 8000000043112, 'X1', 'Omie 430 outro', 'KG', '01');
  assert (select count(*) from produto_codigos_usados where loja_id = 99431) = 0, 'loja omie fora da lápide';
  raise notice '430 TRAVAS OK';
end $$;
