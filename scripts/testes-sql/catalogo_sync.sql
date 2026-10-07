-- Teste do catálogo e do outbox (roda dentro de BEGIN ... ROLLBACK; nada fica no banco).
insert into lojas (id, cnpj, nome, ativo, modo_estoque, vendas_store_id) values (99020, '00000000099020', 'TESTE CATALOGO', true, 'proprio', gen_random_uuid());
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99021, '00000000099021', 'TESTE OMIE', true, 'omie');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99020, 8000000009901, 'Geral', 'S');

do $$
declare r jsonb; n int; v_mae bigint; v_g1 uuid := gen_random_uuid(); v_g2 uuid := gen_random_uuid(); v_pm uuid := gen_random_uuid();
        v_p1 uuid := gen_random_uuid(); v_p2 uuid := gen_random_uuid(); v_ps uuid := gen_random_uuid(); cm text; c1 text; c2 text; cs text;
begin
  -- 1) produto criado no Estoque entra no outbox, edições seguidas viram UMA linha pendente
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, valor_unitario) values (99020, 8000000009801, '90001', 'Suco', 'UN', '04', 5);
  update produtos set descricao = 'Suco de Uva' where loja_id = 99020 and codigo = '90001';
  select count(*) into n from sync_outbox where loja_id = 99020 and entidade = 'produto' and ref = '90001' and status = 'pending';
  assert n = 1, 'outbox colapsa em uma linha: ' || n;
  update sync_outbox set status = 'ok' where loja_id = 99020;
  update produtos set descricao = 'Suco de Uva 300ml' where loja_id = 99020 and codigo = '90001';
  select count(*) into n from sync_outbox where loja_id = 99020 and status = 'pending';
  assert n = 1, 'nova edição depois de entregue gera nova linha pendente';
  delete from sync_outbox where loja_id = 99020;

  -- 2) loja omie nunca grava outbox; loja sem vendas_store_id também não
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (99021, 8000000009802, 'X1', 'Omie', 'UN');
  select count(*) into n from sync_outbox where loja_id = 99021;
  assert n = 0, 'loja omie sem outbox';

  -- 3) aplicar catálogo do Vendas: grupos, mãe, variações, simples; sem eco no outbox
  r := aplicar_catalogo_vendas(99020, jsonb_build_object(
    'grupos', jsonb_build_array(
      jsonb_build_object('vendas_ref', v_g1, 'nome', 'Bebidas', 'ordem', 1, 'ativo', true),
      jsonb_build_object('vendas_ref', v_g2, 'nome', 'Sucos', 'pai_vendas_ref', v_g1, 'ordem', 1, 'ativo', true)),
    'produtos', jsonb_build_array(
      jsonb_build_object('vendas_ref', v_pm, 'nome', 'Moqueca', 'preco', 80, 'mae', true, 'grupo_vendas_ref', v_g2),
      jsonb_build_object('vendas_ref', v_p1, 'nome', 'Moqueca Individual', 'preco', 80, 'pai_vendas_ref', v_pm, 'atributos', jsonb_build_object('tamanho', 'Individual')),
      jsonb_build_object('vendas_ref', v_ps, 'nome', 'Água', 'preco', 4.5, 'grupo_vendas_ref', v_g2))));
  assert (r -> 'produtos' -> 0 ->> 'criado')::boolean, 'mãe criada';
  cm := r -> 'produtos' -> 0 ->> 'codigo';
  cs := r -> 'produtos' -> 2 ->> 'codigo';
  assert cm like '90%' and cs like '90%' and cm <> cs, 'códigos 90xxx diferentes: ' || cm || ' ' || cs;
  select count(*) into n from sync_outbox where loja_id = 99020 and status = 'pending';
  assert n = 0, 'sem eco: o que veio do Vendas não volta ao outbox (' || n || ')';
  assert (select eh_mae from produtos where loja_id = 99020 and codigo = cm), 'mãe marcada';

  assert (select produto_pai_codigo from produtos where loja_id = 99020 and vendas_ref = v_p1) = (select codigo_produto from produtos where loja_id = 99020 and codigo = cm), 'variação ligada à mãe pelo id do Vendas no mesmo lote';
  -- variação com pai (segunda chamada, mãe já existe)
  r := aplicar_catalogo_vendas(99020, jsonb_build_object('produtos', jsonb_build_array(
      jsonb_build_object('vendas_ref', v_p2, 'nome', 'Moqueca Família', 'preco', 150, 'pai_codigo', cm, 'atributos', jsonb_build_object('tamanho', 'Família')))));
  c2 := r -> 'produtos' -> 0 ->> 'codigo';
  assert (select produto_pai_codigo from produtos where loja_id = 99020 and codigo = c2) = (select codigo_produto from produtos where loja_id = 99020 and codigo = cm), 'variação ligada à mãe';

  -- 4) mãe não tem estoque; variação tem
  begin
    perform registrar_movimento(99020, 8000000009901, (select codigo_produto from produtos where loja_id = 99020 and codigo = cm), 'ENT', 'T', 'm1', 5, 1);
    assert false, 'movimento na mãe deveria falhar';
  exception when check_violation then null; end;
  r := registrar_movimento(99020, 8000000009901, (select codigo_produto from produtos where loja_id = 99020 and codigo = c2), 'ENT', 'T', 'v1', 5, 20);
  assert (r ->> 'saldo')::numeric = 5, 'variação recebe movimento';
  -- produto com movimento não vira mãe
  begin
    update produtos set eh_mae = true where loja_id = 99020 and codigo = c2;
    assert false, 'produto com movimento não pode virar mãe';
  exception when check_violation then null; end;
  -- variação de variação é recusada
  begin
    insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, produto_pai_codigo)
      values (99020, 8000000009803, '90999', 'Neto', 'UN', (select codigo_produto from produtos where loja_id = 99020 and codigo = c2));
    assert false, 'filho de variação deveria falhar';
  exception when check_violation then null; end;

  -- 5) conflitos: preço do Vendas sempre vence; nome só se mais novo; código nunca muda
  r := aplicar_catalogo_vendas(99020, jsonb_build_object('produtos', jsonb_build_array(
      jsonb_build_object('vendas_ref', v_ps, 'codigo', cs, 'nome', 'Água Velha', 'preco', 6, 'updated_at', '2000-01-01T00:00:00Z'))));
  assert (select valor_unitario from produtos where loja_id = 99020 and codigo = cs) = 6, 'preço do Vendas vence';
  assert (select descricao from produtos where loja_id = 99020 and codigo = cs) = 'Água', 'nome mais antigo não vence';
  r := aplicar_catalogo_vendas(99020, jsonb_build_object('produtos', jsonb_build_array(
      jsonb_build_object('vendas_ref', v_ps, 'codigo', cs, 'nome', 'Água Mineral', 'updated_at', '2999-01-01T00:00:00Z'))));
  assert (select descricao from produtos where loja_id = 99020 and codigo = cs) = 'Água Mineral', 'nome mais novo vence';
  assert not (r -> 'produtos' -> 0 ->> 'criado')::boolean, 'não cria duplicado';
  -- reenviar o mesmo payload não duplica
  r := aplicar_catalogo_vendas(99020, jsonb_build_object('produtos', jsonb_build_array(jsonb_build_object('vendas_ref', v_ps, 'nome', 'Água Mineral', 'preco', 6))));
  select count(*) into n from produtos where loja_id = 99020 and vendas_ref = v_ps;
  assert n = 1, 'idempotente';

  -- 6) árvore: ciclo e profundidade
  begin
    update grupos_produto set pai_id = (select id from grupos_produto where loja_id = 99020 and nome = 'Sucos') where loja_id = 99020 and nome = 'Bebidas';
    assert false, 'ciclo deveria falhar';
  exception when check_violation then null; end;
  assert (select pai_id from grupos_produto where loja_id = 99020 and nome = 'Sucos') = (select id from grupos_produto where loja_id = 99020 and nome = 'Bebidas'), 'subgrupo ligado ao grupo';

  -- 7) mapa de volta
  perform registrar_mapa_vendas(99020, jsonb_build_object('produtos', jsonb_build_array(jsonb_build_object('codigo', '90001', 'vendas_ref', gen_random_uuid()))));
  assert (select vendas_ref from produtos where loja_id = 99020 and codigo = '90001') is not null, 'mapa grava vendas_ref';
  perform registrar_mapa_vendas(99020, jsonb_build_object('codigos', jsonb_build_array('90001')));
  assert (select sync_atualizado_em from produtos where loja_id = 99020 and codigo = '90001') is not null, 'carimba entregue';
  select count(*) into n from sync_outbox where loja_id = 99020 and status = 'pending';
  assert n = 0, 'mapa não gera eco';

  -- 8) loja omie recusa
  begin
    perform aplicar_catalogo_vendas(99021, '{}'::jsonb);
    assert false, 'omie recusa';
  exception when sqlstate '22023' then null; end;
  raise notice 'CATALOGO OK';
end $$;
