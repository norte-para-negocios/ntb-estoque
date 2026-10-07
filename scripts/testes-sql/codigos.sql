-- Teste dos códigos por tipo e do cadastro proprio (roda dentro de BEGIN ... ROLLBACK; a migration 132 já está aplicada).
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99003, '00000000099003', 'TESTE CODIGOS', true, 'proprio');
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99004, '00000000099004', 'TESTE CODIGOS OMIE', true, 'omie');

do $$
declare c text; i int; a bigint; b bigint;
begin
  -- prefixo por tipo (padrão do Omie do Sertão)
  assert prefixo_codigo_por_tipo('04') = '90' and prefixo_codigo_por_tipo('00') = '90', 'vendavel 90';
  assert prefixo_codigo_por_tipo('01') = '80', 'materia-prima 80';
  assert prefixo_codigo_por_tipo('03') = '70' and prefixo_codigo_por_tipo('06') = '70', 'intermediario 70';
  assert prefixo_codigo_por_tipo('07') = '60', 'uso e consumo 60';
  assert prefixo_codigo_por_tipo('02') = '50' and prefixo_codigo_por_tipo('08') = '50' and prefixo_codigo_por_tipo('99') = '50', 'embalagem/outros 50';
  assert prefixo_codigo_por_tipo(null) = '90', 'sem tipo = vendavel';

  -- sequência por tipo, sem pular nem repetir
  assert proximo_codigo_produto(99003, '04') = '90001', 'primeiro 90';
  assert proximo_codigo_produto(99003, '04') = '90002', 'segundo 90';
  assert proximo_codigo_produto(99003, '01') = '80001', 'primeiro 80 independe do 90';

  -- pula código que já existe (cadastro manual anterior)
  insert into produtos (loja_id, codigo_produto, codigo, descricao, tipo_item) values (99003, novo_id_produto_proprio(), '70001', 'Manual', '03');
  assert proximo_codigo_produto(99003, '03') = '70002', 'pula existente';

  -- lojas diferentes têm contadores independentes
  assert proximo_codigo_produto(99004, '04') = '90001', 'contador por loja';

  -- ids próprios na faixa alta, crescentes e sem negativos
  assert novo_id_produto_proprio() >= 8000000000001, 'faixa de id de produto';
  assert novo_id_local_proprio() >= 8000000000001, 'faixa de id de local';
  a := novo_id_produto_proprio(); b := novo_id_produto_proprio();
  assert b = a + 1, 'ids crescentes ' || a || ' ' || b;

  -- 50 códigos seguidos únicos
  for i in 1..50 loop
    c := proximo_codigo_produto(99003, '07');
    assert c = '60' || lpad(i::text, 3, '0'), 'sequencia ' || i || ' ' || c;
  end loop;

  -- loja omie não é afetada pela trava de código (duplicado permitido como sempre foi)
  insert into produtos (loja_id, codigo_produto, codigo, descricao) values (99004, 1, 'X1', 'a');
  insert into produtos (loja_id, codigo_produto, codigo, descricao) values (99004, 2, 'X1', 'b');

  raise notice 'CODIGOS OK';
end $$;
