-- Teste da 143 (roda dentro de BEGIN ... ROLLBACK).
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99143, '00000000099143', 'TESTE 143', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99143, 8000000009431, 'Geral', 'S'), (99143, 8000000009432, 'Bar', 'N');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values (99143, 8000000009401, '80001', 'Limao', 'G', '01');
do $$ declare c1 numeric; c2 numeric; n int;
begin
  perform registrar_movimento(99143, 8000000009432, 8000000009401, 'ENT', 'T', 'a', 100, 1.00);
  perform registrar_movimento(99143, 8000000009431, 8000000009401, 'ENT', 'T', 'b', 100, 3.00);
  select n_cmc into c1 from posicao_estoques where loja_id=99143 and codigo_local_estoque=8000000009432;
  select n_cmc into c2 from posicao_estoques where loja_id=99143 and codigo_local_estoque=8000000009431;
  assert c1 = 2 and c2 = 2, 'cmc projetado nos dois locais: ' || c1 || ' ' || c2;
  update estoque_saldos set saldo = saldo where loja_id = 99143;
  n := projetar_posicao_dia(99143);
  assert n = 2, 'projetar atualiza as 2 linhas existentes: ' || n;
  raise notice 'POSICAO143 OK';
end $$;
