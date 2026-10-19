-- Teste da migration 240 (compradores + requisição de compra). Cópia local (fb + 187, 188, 190–195, 200, 201, 240).
-- Nunca em produção. Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d c2 < scripts/testes-sql/240_requisicao_compra.sql
begin;
do $$
declare v_loja bigint; v_outra bigint; v_omie bigint; v_forn bigint; v_comp bigint; v_comp_outra bigint; v_comp_inativo bigint;
        r jsonb; v_r1 bigint; v_r2 bigint; v_r3 bigint; v_ped bigint; n int; s record; v_peds jsonb;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 240', '00000000000240', 'proprio') returning id into v_loja;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 240 B', '00000000000241', 'proprio') returning id into v_outra;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 240 OMIE', '00000000000242', 'omie') returning id into v_omie;
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values
    (v_loja, 701, 'P701', 'TOMATE', 'KG'), (v_loja, 702, 'P702', 'CEBOLA', 'KG'), (v_loja, 703, 'P703', 'CERVEJA', 'UN');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (v_omie, 701, 'P701', 'TOMATE', 'KG');
  insert into fornecedores (loja_id, codigo_omie, razao_social, cnpj_cpf, origem) values (v_loja, 8000000000701, 'HORTI LTDA', '11.222.333/0001-81', 'proprio') returning id into v_forn;

  -- 1. compradores: nome obrigatório, duplicado recusado, loja Omie recusa
  r := comp_salvar(v_loja, '{"nome":"Ana  Compras"}'::jsonb); v_comp := (r->>'id')::bigint;
  begin perform comp_salvar(v_loja, '{"nome":"ana compras"}'::jsonb); raise exception 'aceitou nome duplicado'; exception when sqlstate '22023' then null; end;
  begin perform comp_salvar(v_loja, '{"nome":"  "}'::jsonb); raise exception 'aceitou nome vazio'; exception when sqlstate '22023' then null; end;
  begin perform comp_salvar(v_omie, '{"nome":"X"}'::jsonb); raise exception 'loja omie criou comprador'; exception when sqlstate '22023' then null; end;
  begin perform comp_salvar(v_loja, '{"nome":"Y","user_id":"00000000-0000-0000-0000-000000000000"}'::jsonb); raise exception 'aceitou usuário de fora'; exception when sqlstate '22023' then null; end;
  r := comp_salvar(v_outra, '{"nome":"Bia"}'::jsonb); v_comp_outra := (r->>'id')::bigint;
  r := comp_salvar(v_loja, '{"nome":"Caio","ativo":false}'::jsonb); v_comp_inativo := (r->>'id')::bigint;

  -- 2. comprador no pedido: de outra loja ou inativo = recusado; ativo = gravado
  begin perform pc_salvar(v_loja, jsonb_build_object('fornecedor_nome', 'F', 'comprador_id', v_comp_outra, 'itens', '[{"codigo_produto":701,"quantidade":1}]'::jsonb));
    raise exception 'pedido com comprador de outra loja'; exception when sqlstate '22023' then null; end;
  begin perform pc_salvar(v_loja, jsonb_build_object('fornecedor_nome', 'F', 'comprador_id', v_comp_inativo, 'itens', '[{"codigo_produto":701,"quantidade":1}]'::jsonb));
    raise exception 'pedido com comprador inativo'; exception when sqlstate '22023' then null; end;
  r := pc_salvar(v_loja, jsonb_build_object('fornecedor_nome', 'F', 'comprador_id', v_comp, 'itens', '[{"codigo_produto":701,"quantidade":1}]'::jsonb));
  if (select comprador_id from pedidos_compra where id = (r->>'id')::bigint) <> v_comp then raise exception 'comprador do pedido'; end if;
  -- comprador desativado depois: editar o pedido sem trocar o comprador continua valendo
  perform comp_salvar(v_loja, jsonb_build_object('id', v_comp, 'nome', 'Ana Compras', 'ativo', false));
  perform pc_salvar(v_loja, jsonb_build_object('id', (r->>'id')::bigint, 'fornecedor_nome', 'F', 'comprador_id', v_comp, 'itens', '[{"codigo_produto":701,"quantidade":2}]'::jsonb));
  perform comp_salvar(v_loja, jsonb_build_object('id', v_comp, 'nome', 'Ana Compras', 'ativo', true));

  -- 3. requisição: loja Omie recusa; número sequencial; idempotência; comprador de outra loja recusado
  begin perform rc_salvar(v_omie, '{"itens":[{"codigo_produto":701,"quantidade":1}]}'::jsonb); raise exception 'loja omie criou requisição'; exception when sqlstate '22023' then null; end;
  begin perform rc_salvar(v_loja, jsonb_build_object('comprador_id', v_comp_outra, 'itens', '[{"codigo_produto":701,"quantidade":1}]'::jsonb));
    raise exception 'requisição com comprador de outra loja'; exception when sqlstate '22023' then null; end;
  begin perform rc_salvar(v_loja, '{"itens":[{"codigo_produto":999,"quantidade":1}]}'::jsonb); raise exception 'produto inexistente'; exception when sqlstate '22023' then null; end;
  begin perform rc_salvar(v_loja, '{"itens":[]}'::jsonb); raise exception 'sem itens'; exception when sqlstate '22023' then null; end;
  r := rc_salvar(v_loja, jsonb_build_object('chave_idempotencia', 'rq-1', 'sugestao_entrega', '2026-10-30', 'comprador_id', v_comp,
        'itens', jsonb_build_array(
          jsonb_build_object('codigo_produto', 701, 'quantidade', 10, 'preco_sugerido', 5, 'fornecedor_id', v_forn),
          jsonb_build_object('codigo_produto', 703, 'quantidade', 2, 'preco_sugerido', 30, 'unidade', 'CX', 'fator', 12))), 'u1', 'Ana');
  v_r1 := (r->>'id')::bigint;
  if (r->>'numero')::int <> 1 then raise exception 'numero %', r; end if;
  if (select fornecedor_cnpj from requisicoes_compra_itens where requisicao_id = v_r1 and linha = 1) <> '11222333000181' then raise exception 'cnpj do cadastro'; end if;
  if (select unidade from requisicoes_compra_itens where requisicao_id = v_r1 and linha = 1) <> 'KG' then raise exception 'unidade padrão'; end if;
  r := rc_salvar(v_loja, '{"chave_idempotencia":"rq-1","itens":[{"codigo_produto":702,"quantidade":1}]}'::jsonb);
  if (r->>'duplicado')::boolean is not true or (r->>'id')::bigint <> v_r1 then raise exception 'idempotencia %', r; end if;
  r := rc_salvar(v_loja, jsonb_build_object('sugestao_entrega', '2026-10-25', 'comprador_id', v_comp, 'itens', jsonb_build_array(
          jsonb_build_object('codigo_produto', 701, 'quantidade', 5, 'preco_sugerido', 8, 'fornecedor_cnpj', '11222333000181'),
          jsonb_build_object('codigo_produto', 702, 'quantidade', 3, 'preco_sugerido', 4, 'fornecedor_nome', 'Feira  São Joaquim'))));
  v_r2 := (r->>'id')::bigint;
  if (r->>'numero')::int <> 2 then raise exception 'numero 2 %', r; end if;
  r := rc_salvar(v_loja, '{"itens":[{"codigo_produto":702,"quantidade":1,"fornecedor_nome":"feira sao joaquim"}]}'::jsonb);
  v_r3 := (r->>'id')::bigint;

  -- 4. transições
  begin perform rc_acao(v_loja, v_r1, 'reabrir'); raise exception 'reabriu aberta'; exception when sqlstate '22023' then null; end;
  begin perform rc_acao(v_loja, v_r1, 'recusar'); raise exception 'recusou sem motivo'; exception when sqlstate '22023' then null; end;
  begin perform rc_acao(v_outra, v_r1, 'aprovar'); raise exception 'aprovou de outra loja'; exception when sqlstate '22023' then null; end;
  perform rc_acao(v_loja, v_r1, 'recusar', 'u2', 'Dono', 'caro');
  if (select motivo_recusa from requisicoes_compra where id = v_r1) <> 'caro' then raise exception 'motivo'; end if;
  perform rc_acao(v_loja, v_r1, 'reabrir', 'u1', 'Ana');
  if (select motivo_recusa from requisicoes_compra where id = v_r1) is not null then raise exception 'reabrir limpa a recusa'; end if;
  perform rc_salvar(v_loja, jsonb_build_object('id', v_r1, 'sugestao_entrega', '2026-10-30', 'comprador_id', v_comp,
        'itens', jsonb_build_array(
          jsonb_build_object('codigo_produto', 701, 'quantidade', 10, 'preco_sugerido', 5, 'fornecedor_id', v_forn),
          jsonb_build_object('codigo_produto', 703, 'quantidade', 2, 'preco_sugerido', 30, 'unidade', 'CX', 'fator', 12))), 'u1', 'Ana');
  perform rc_acao(v_loja, v_r1, 'aprovar', 'u2', 'Dono');
  begin perform rc_salvar(v_loja, jsonb_build_object('id', v_r1, 'itens', '[{"codigo_produto":701,"quantidade":1}]'::jsonb)); raise exception 'editou aprovada'; exception when sqlstate '22023' then null; end;
  perform rc_acao(v_loja, v_r2, 'aprovar', 'u2', 'Dono');

  -- 5. gerar pedidos: requisição aberta no lote = recusa tudo, nada criado
  select count(*) into n from pedidos_compra where loja_id = v_loja;
  begin perform rc_gerar_pedidos(v_loja, array[v_r1, v_r3], 'gerar-teste-0'); raise exception 'gerou com requisição aberta'; exception when sqlstate '22023' then null; end;
  begin perform rc_gerar_pedidos(v_outra, array[v_r1], 'gerar-teste-0'); raise exception 'gerou de outra loja'; exception when sqlstate '22023' then null; end;
  begin perform rc_gerar_pedidos(v_loja, array[v_r1], 'x'); raise exception 'chave curta'; exception when sqlstate '22023' then null; end;
  if (select count(*) from pedidos_compra where loja_id = v_loja) <> n then raise exception 'criou pedido ao recusar'; end if;

  -- r1 (horti pelo cadastro: tomate 10 × 5; sem fornecedor: cerveja 2 CX) + r2 (horti pelo CNPJ = mesmo cadastro: tomate 5 × 8;
  -- feira: cebola 3) = 3 pedidos: horti (tomate 15 a (50 + 40) / 15 = 6), feira e "a definir"
  r := rc_gerar_pedidos(v_loja, array[v_r2, v_r1, v_r1], 'gerar-teste-1', 'u1', 'Ana');
  v_peds := r->'pedidos';
  if jsonb_array_length(v_peds) <> 3 then raise exception 'pedidos gerados: %', r; end if;
  if (select count(*) from pedidos_compra where loja_id = v_loja and origem = 'requisicao' and etapa = 'rascunho') <> 3 then raise exception 'rascunhos'; end if;
  if exists (select 1 from requisicoes_compra where id in (v_r1, v_r2) and etapa <> 'pedido') then raise exception 'etapa pedido'; end if;
  if exists (select 1 from requisicoes_compra_itens where requisicao_id in (v_r1, v_r2) and (pedido_id is null or pedido_item_id is null)) then raise exception 'item sem pedido'; end if;
  -- grupo do cadastro: fornecedor_id, previsão = a menor (25/10), comprador comum, obs interna
  select p.* into s from pedidos_compra p where p.loja_id = v_loja and p.fornecedor_id = v_forn and p.origem = 'requisicao';
  if s.previsao_entrega <> '2026-10-25' or s.comprador_id <> v_comp or s.obs_interna <> 'Das requisições nº 1, 2' or s.fornecedor_cnpj <> '11222333000181' then raise exception 'pedido do cadastro %', s; end if;
  select i.* into s from pedidos_compra_itens i join pedidos_compra p on p.id = i.pedido_id where p.fornecedor_id = v_forn and p.origem = 'requisicao';
  if s.quantidade <> 15 or s.preco_unitario <> 6 then raise exception 'tomate somado %', s; end if;
  if not exists (select 1 from pedidos_compra where loja_id = v_loja and origem = 'requisicao' and fornecedor_nome = 'Fornecedor a definir') then raise exception 'a definir'; end if;
  -- repetir a chave: mesmos pedidos, nada novo
  r := rc_gerar_pedidos(v_loja, array[v_r1, v_r2], 'gerar-teste-1');
  if (r->>'duplicado')::boolean is not true or jsonb_array_length(r->'pedidos') <> 3 then raise exception 'idempotência gerar %', r; end if;
  if (select count(*) from pedidos_compra where loja_id = v_loja and origem = 'requisicao') <> 3 then raise exception 'duplicou'; end if;
  -- outra chave com as mesmas requisições: já viraram pedido
  begin perform rc_gerar_pedidos(v_loja, array[v_r1], 'gerar-teste-2'); raise exception 'gerou de novo'; exception when sqlstate '22023' then null; end;

  -- 6. soma do mesmo produto no grupo, preço médio ponderado: duas requisições da feira (nome com acento/caixa diferentes)
  perform rc_acao(v_loja, v_r3, 'aprovar');
  r := rc_salvar(v_loja, '{"itens":[{"codigo_produto":702,"quantidade":3,"preco_sugerido":6,"fornecedor_nome":"FEIRA SÃO JOAQUIM"}]}'::jsonb);
  perform rc_acao(v_loja, (r->>'id')::bigint, 'aprovar');
  update requisicoes_compra_itens set preco_sugerido = 2 where requisicao_id = v_r3;
  r := rc_gerar_pedidos(v_loja, array[v_r3, (r->>'id')::bigint], 'gerar-teste-3');
  if jsonb_array_length(r->'pedidos') <> 1 then raise exception 'feira agrupada: %', r; end if;
  v_ped := (r->'pedidos'->0->>'id')::bigint;
  select * into s from pedidos_compra_itens where pedido_id = v_ped;
  if s.quantidade <> 4 or s.preco_unitario <> 5 then raise exception 'soma/ponderado %', s; end if;   -- (1×2 + 3×6) / 4 = 5
  if (select comprador_id from pedidos_compra where id = v_ped) is not null then raise exception 'sem comprador comum = sem comprador'; end if;

  -- 7. eventos imutáveis
  begin delete from requisicoes_compra_eventos where requisicao_id = v_r1; raise exception 'apagou evento'; exception when sqlstate '55000' then null; end;
  if (select count(*) from requisicoes_compra_eventos where requisicao_id = v_r1 and tipo = 'pedido_gerado') <> 1 then raise exception 'evento pedido_gerado'; end if;

  -- 8. sessão autenticada só lê; não executa as funções
  if has_function_privilege('authenticated', 'rc_salvar(bigint, jsonb, text, text)', 'execute') then raise exception 'authenticated executa rc_salvar'; end if;
  if has_table_privilege('authenticated', 'requisicoes_compra', 'insert') or has_table_privilege('anon', 'compradores', 'select') then raise exception 'grants'; end if;
  raise notice 'requisição de compra (240) OK';
end $$;
rollback;
