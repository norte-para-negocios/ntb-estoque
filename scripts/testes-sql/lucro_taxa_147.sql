-- Roda dentro de BEGIN ... ROLLBACK (depois da 147).
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99145, '00000000099145', 'TESTE LUCRO TAXA', true, 'proprio');
insert into vendas_proprio (id, loja_id, pedido_ref, data, hora, tipo, valor, taxa) overriding system value
  values (991450, 99145, 'ped-taxa', '2026-10-07', '12:00:00', 'mesa', 33, 3);
insert into vendas_proprio_itens (venda_id, linha, codigo, codigo_produto, nome, quantidade, valor_unitario, desconto, valor)
  values (991450, 1, '', null, 'Taxa de Serviço', 1, 3, 0, 3), (991450, 2, '', null, 'Produto avulso', 1, 30, 0, 30);
do $$
declare r record; sb int := 0;
begin
  for r in select * from lucro_proprio(99145, '2026-10-01', '2026-10-31', 'produto') loop
    if r.rotulo = 'Taxa de Serviço' then assert r.itens_sem_baixa = 0, 'taxa nao pode contar como sem baixa'; end if;
    sb := sb + r.itens_sem_baixa;
  end loop;
  assert sb = 1, 'so o produto avulso conta como sem baixa: ' || sb;
  raise notice 'LUCRO TAXA 147 OK';
end $$;
