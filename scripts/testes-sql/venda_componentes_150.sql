-- Teste da migration 150 (roda dentro de BEGIN ... ROLLBACK, depois da 150): pizza meio a meio baixa por componente.
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99150, '00000000099150', 'TESTE COMPONENTES', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99150, 8000000150901, 'Cozinha', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, descricao_familia) values
  (99150, 8000000150801, '90013', 'Meia Calabresa', 'UN', '04', 'Pizzas'),
  (99150, 8000000150802, '90014', 'Meia Mussarela', 'UN', '04', 'Pizzas'),
  (99150, 8000000150803, '90020', 'Refrigerante', 'UN', '00', 'Bebidas');

do $$
declare r record; n int; v numeric;
begin
  perform registrar_movimento(99150, 8000000150901, 8000000150801, 'ENT', 'T', 'e1', 10, 14.80);
  perform registrar_movimento(99150, 8000000150901, 8000000150802, 'ENT', 'T', 'e2', 10, 13.60);
  perform registrar_movimento(99150, 8000000150901, 8000000150803, 'ENT', 'T', 'e3', 10, 4.00);

  -- venda nova (com componentes): pizza meio a meio 59 (sem código) + refri 15 + taxa 7,40
  perform registrar_venda_proprio(99150, jsonb_build_object('pedidoRef', 'ped-mm', 'data', '2026-10-07', 'valor', 81.4, 'taxa', 7.4,
    'itens', jsonb_build_array(
      jsonb_build_object('linha', 1, 'codigo', '', 'nome', 'Pizza Meio a Meio', 'quantidade', 1, 'valorUnitario', 59, 'valor', 59, 'componentes', jsonb_build_array('90013', '90014')),
      jsonb_build_object('linha', 2, 'codigo', '90020', 'nome', 'Refrigerante', 'quantidade', 1, 'valorUnitario', 15, 'valor', 15),
      jsonb_build_object('linha', 3, 'codigo', '', 'nome', 'Taxa de Serviço', 'quantidade', 1, 'valorUnitario', 7.4, 'valor', 7.4))));
  perform registrar_movimento(99150, 8000000150901, 8000000150801, 'SAI', 'VENDA', 'ped-mm', 1, null, null, null, 1);
  perform registrar_movimento(99150, 8000000150901, 8000000150802, 'SAI', 'VENDA', 'ped-mm', 1, null, null, null, 2);
  perform registrar_movimento(99150, 8000000150901, 8000000150803, 'SAI', 'VENDA', 'ped-mm', 1, null, null, null, 3);

  select array_length(componentes, 1) into n from vendas_proprio_itens i join vendas_proprio v on v.id = i.venda_id where v.pedido_ref = 'ped-mm' and i.linha = 1;
  assert n = 2, 'componentes gravados ' || coalesce(n::text, 'null');

  for r in select * from lucro_proprio(99150, '2026-10-01', '2026-10-31', 'produto') loop
    if r.rotulo = 'Pizza Meio a Meio' then
      assert r.cmv = 28.40, 'cmv da pizza = soma das metades: ' || r.cmv;
      assert r.itens_sem_baixa = 0, 'pizza nao e sem baixa';
    elsif r.rotulo = 'Refrigerante' then
      assert r.cmv = 4, 'cmv refri ' || r.cmv;
    elsif r.rotulo = 'Taxa de Serviço' then
      assert r.cmv = 0 and r.itens_sem_baixa = 0, 'taxa';
    end if;
  end loop;
  select sum(cmv) into v from lucro_proprio(99150, '2026-10-01', '2026-10-31', 'produto');
  assert v = 32.40, 'cmv total ' || v;

  -- família/tipo da pizza sem código vêm do primeiro componente
  select valor into v from faturamento_importado where loja_id = 99150 and dimensao = 'familia' and rotulo = 'Pizzas' and mes = '2026-10';
  assert v = 59, 'familia da pizza pelo componente ' || coalesce(v::text, 'null');
  for r in select * from lucro_proprio(99150, '2026-10-01', '2026-10-31', 'familia') loop
    if r.rotulo = 'Pizzas' then assert r.cmv = 28.40, 'lucro por familia ' || r.cmv; end if;
  end loop;

  -- venda antiga (sem componentes): o custo dos sabores não some, vai rateado nas linhas que não são taxa
  perform registrar_venda_proprio(99150, jsonb_build_object('pedidoRef', 'ped-antigo', 'data', '2026-10-07', 'valor', 64,
    'itens', jsonb_build_array(
      jsonb_build_object('linha', 1, 'codigo', '', 'nome', 'Pizza Antiga', 'quantidade', 1, 'valorUnitario', 59, 'valor', 59),
      jsonb_build_object('linha', 2, 'codigo', '90020', 'nome', 'Refrigerante', 'quantidade', 1, 'valorUnitario', 15, 'valor', 15),
      jsonb_build_object('linha', 3, 'codigo', '', 'nome', 'Taxa de Serviço', 'quantidade', 1, 'valorUnitario', 5, 'valor', 5))));
  perform registrar_movimento(99150, 8000000150901, 8000000150803, 'SAI', 'VENDA', 'ped-antigo', 1, null, null, null, 3);
  perform registrar_movimento(99150, 8000000150901, 8000000150801, 'SAI', 'VENDA', 'ped-antigo', 1, null, null, null, 1);
  perform registrar_movimento(99150, 8000000150901, 8000000150802, 'SAI', 'VENDA', 'ped-antigo', 1, null, null, null, 2);
  for r in select * from lucro_proprio(99150, '2026-10-01', '2026-10-31', 'produto') loop
    -- os sabores sem dono vão para a linha sem custo próprio (a pizza), não para o refrigerante que já tem o dele
    if r.rotulo = 'Pizza Antiga' then assert r.cmv = 28.40 and r.itens_sem_baixa = 0, 'orfao para a linha livre ' || r.cmv; end if;
    if r.rotulo = 'Refrigerante' then assert r.cmv = 8, 'refri das duas vendas so com o proprio custo ' || r.cmv; end if;
  end loop;
  select sum(cmv) into v from lucro_proprio(99150, '2026-10-01', '2026-10-31', 'produto');
  assert v = 64.80, 'cmv total com venda antiga ' || v;

  -- reenvio da venda substitui itens e mantém componentes
  perform registrar_venda_proprio(99150, jsonb_build_object('pedidoRef', 'ped-mm', 'data', '2026-10-07', 'valor', 59,
    'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'codigo', '', 'nome', 'Pizza Meio a Meio', 'quantidade', 1, 'valorUnitario', 59, 'valor', 59, 'componentes', jsonb_build_array('90014')))));
  select array_length(componentes, 1) into n from vendas_proprio_itens i join vendas_proprio v on v.id = i.venda_id where v.pedido_ref = 'ped-mm' and i.linha = 1;
  assert n = 1, 'reenvio troca componentes';
  raise notice 'VENDA COMPONENTES 150 OK';
end $$;
