-- Teste da migration 200 (pedido de compra do estoque próprio). Cópia local com o esquema até a 186 + 200.
-- Nunca em produção. Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d fasec < scripts/testes-sql/200_pedido_compra.sql
begin;
do $$
declare v_loja bigint; v_omie bigint; r jsonb; v_ped bigint; v_ped2 bigint; n int; v_comp bigint; v_ci1 bigint; v_ci2 bigint; s record; e text;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 200', '00000000000001', 'proprio') returning id into v_loja;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 200 OMIE', '00000000000002', 'omie') returning id into v_omie;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, 1, 'DEPOSITO');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (v_loja, 501, 'P501', 'TOMATE', 'KG'), (v_loja, 502, 'P502', 'CERVEJA', 'UN');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (v_omie, 501, 'P501', 'TOMATE', 'KG');

  -- 1. loja Omie não cria pedido local
  begin
    perform pc_salvar(v_omie, '{"fornecedor_nome":"X","itens":[{"codigo_produto":501,"quantidade":1}]}'::jsonb);
    raise exception 'loja omie criou pedido';
  exception when sqlstate '22023' then null; end;

  -- 2. cria, número sequencial e idempotência
  r := pc_salvar(v_loja, jsonb_build_object('chave_idempotencia', 'k1', 'fornecedor_nome', 'HORTIFRUTI', 'fornecedor_cnpj', '11.222.333/0001-81',
        'parcelas', '[{"dias":30,"percentual":50},{"dias":60,"percentual":50}]'::jsonb,
        'itens', '[{"codigo_produto":501,"quantidade":10,"preco_unitario":5},{"codigo_produto":502,"quantidade":2,"preco_unitario":30,"unidade":"CX","fator":12}]'::jsonb), 'u1', 'Ana');
  v_ped := (r->>'id')::bigint;
  if (r->>'numero')::int <> 1 then raise exception 'numero %', r; end if;
  r := pc_salvar(v_loja, jsonb_build_object('chave_idempotencia', 'k1', 'fornecedor_nome', 'HORTIFRUTI', 'itens', '[{"codigo_produto":501,"quantidade":1}]'::jsonb));
  if (r->>'duplicado')::boolean is not true or (r->>'id')::bigint <> v_ped then raise exception 'idempotencia %', r; end if;
  r := pc_salvar(v_loja, jsonb_build_object('fornecedor_nome', 'OUTRO', 'itens', '[{"codigo_produto":502,"quantidade":1}]'::jsonb));
  v_ped2 := (r->>'id')::bigint;
  if (r->>'numero')::int <> 2 then raise exception 'numero 2: %', r; end if;
  select * into s from pedidos_compra_itens_situacao where pedido_id = v_ped and codigo_produto = 502;
  if s.quantidade_base <> 24 or s.preco_base <> 2.5 or s.unidade <> 'CX' then raise exception 'base %', s; end if;
  select unidade into e from pedidos_compra_itens where pedido_id = v_ped and codigo_produto = 501;
  if e <> 'KG' then raise exception 'unidade padrão do produto: %', e; end if;

  -- 3. parcelas que não fecham 100%
  begin
    perform pc_salvar(v_loja, '{"fornecedor_nome":"X","parcelas":[{"dias":30,"percentual":40}],"itens":[{"codigo_produto":501,"quantidade":1}]}'::jsonb);
    raise exception 'aceitou parcelas 40%%';
  exception when sqlstate '22023' then null; end;

  -- 4. transições
  begin perform pc_acao(v_loja, v_ped, 'reabrir'); raise exception 'reabriu rascunho'; exception when sqlstate '22023' then null; end;
  perform pc_acao(v_loja, v_ped, 'enviar', 'u1', 'Ana');
  begin
    perform pc_salvar(v_loja, jsonb_build_object('id', v_ped, 'fornecedor_nome', 'H', 'itens', '[{"codigo_produto":501,"quantidade":1}]'::jsonb));
    raise exception 'editou fora do rascunho';
  exception when sqlstate '22023' then null; end;
  begin perform pc_acao(v_loja, v_ped, 'reprovar'); raise exception 'reprovou sem motivo'; exception when sqlstate '22023' then null; end;
  perform pc_acao(v_loja, v_ped, 'reprovar', 'u2', 'Dono', 'preço alto');
  perform pc_salvar(v_loja, jsonb_build_object('id', v_ped, 'fornecedor_nome', 'HORTIFRUTI', 'fornecedor_cnpj', '11222333000181',
        'itens', '[{"codigo_produto":501,"quantidade":10,"preco_unitario":4.5},{"codigo_produto":502,"quantidade":2,"preco_unitario":30,"unidade":"CX","fator":12}]'::jsonb), 'u1', 'Ana');
  perform pc_acao(v_loja, v_ped, 'enviar', 'u1', 'Ana');
  r := pc_acao(v_loja, v_ped, 'aprovar', 'u2', 'Dono');
  if r->>'para' <> 'aprovado' then raise exception 'aprovar %', r; end if;
  if (select aprovado_por_nome from pedidos_compra where id = v_ped) <> 'Dono' then raise exception 'aprovado_por'; end if;

  -- 5. nota do fornecedor: 8 kg de tomate e 1 caixa (12 un) de cerveja; vínculo e recebido só depois de lançar
  insert into compras_proprio (loja_id, origem, numero, fornecedor_cnpj, fornecedor_nome, status) values (v_loja, 'manual', '123', '11222333000181', 'HORTIFRUTI', 'pendente') returning id into v_comp;
  insert into compras_proprio_itens (compra_id, loja_id, linha, descricao, quantidade, valor_unitario, valor_total, fator, codigo_produto)
    values (v_comp, v_loja, 1, 'TOMATE', 8, 4.8, 38.4, 1, 501) returning id into v_ci1;
  insert into compras_proprio_itens (compra_id, loja_id, linha, descricao, quantidade, valor_unitario, valor_total, fator, codigo_produto)
    values (v_comp, v_loja, 2, 'CERVEJA CX', 1, 30, 30, 12, 502) returning id into v_ci2;
  insert into compras_proprio_itens (compra_id, loja_id, linha, descricao, quantidade, valor_unitario, valor_total, fator)
    values (v_comp, v_loja, 3, 'BRINDE', 1, 0, 0, 1);
  begin perform pc_vincular_nota(v_loja, v_ped2, v_comp); raise exception 'vinculou pedido em rascunho'; exception when sqlstate '22023' then null; end;
  r := pc_vincular_nota(v_loja, v_ped, v_comp, 'u1', 'Ana');
  if (r->>'vinculados')::int <> 2 or (r->>'fora_do_pedido')::int <> 1 then raise exception 'vincular %', r; end if;
  r := pc_vincular_nota(v_loja, v_ped, v_comp, 'u1', 'Ana');  -- refazer não duplica
  select count(*) into n from pedidos_compra_vinculos where pedido_id = v_ped;
  if n <> 2 then raise exception 'vinculos depois de refazer: %', n; end if;
  select * into s from pedidos_compra_itens_situacao where pedido_id = v_ped and codigo_produto = 501;
  if s.vinculado <> 8 or s.recebido <> 0 then raise exception 'antes de lançar %', s; end if;
  update compras_proprio_itens set lancado = true where compra_id = v_comp;
  update compras_proprio_itens set quantidade_recebida = 7.5 where id = v_ci1;
  select * into s from pedidos_compra_itens_situacao where pedido_id = v_ped and codigo_produto = 501;
  if s.recebido <> 7.5 then raise exception 'recebido usa a quantidade recebida: %', s; end if;
  select * into s from pedidos_compra_itens_situacao where pedido_id = v_ped and codigo_produto = 502;
  if s.recebido <> 12 then raise exception 'recebido em unidade de estoque: %', s; end if;
  begin perform pc_acao(v_loja, v_ped, 'reabrir'); raise exception 'reabriu com nota'; exception when sqlstate '22023' then null; end;

  -- 6. nota cancelada não conta; outro fornecedor não vincula
  update compras_proprio set status = 'cancelada' where id = v_comp;
  select * into s from pedidos_compra_itens_situacao where pedido_id = v_ped and codigo_produto = 501;
  if s.vinculado <> 0 or s.recebido <> 0 then raise exception 'nota cancelada contou %', s; end if;
  update compras_proprio set status = 'lancada', fornecedor_cnpj = '99888777000100' where id = v_comp;
  begin perform pc_vincular_nota(v_loja, v_ped, v_comp); raise exception 'vinculou outro fornecedor'; exception when sqlstate '22023' then null; end;

  -- 7. desvincular, reabrir, cancelar com motivo, eventos imutáveis
  perform pc_desvincular_nota(v_loja, v_ped, v_comp, 'u1', 'Ana');
  perform pc_acao(v_loja, v_ped, 'reabrir', 'u1', 'Ana');
  begin perform pc_acao(v_loja, v_ped, 'cancelar'); raise exception 'cancelou sem motivo'; exception when sqlstate '22023' then null; end;
  perform pc_acao(v_loja, v_ped, 'cancelar', 'u1', 'Ana', 'fornecedor sem estoque');
  begin perform pc_acao(v_loja, v_ped, 'cancelar', null, null, 'de novo'); raise exception 'cancelou 2x'; exception when sqlstate '22023' then null; end;
  select count(*) into n from pedidos_compra_eventos where pedido_id = v_ped;
  if n < 9 then raise exception 'eventos: %', n; end if;
  begin update pedidos_compra_eventos set tipo = 'x' where pedido_id = v_ped; raise exception 'evento alterado'; exception when sqlstate '55000' then null; end;

  -- 8. grants: authenticated só lê; funções só service_role
  if has_function_privilege('authenticated', 'pc_salvar(bigint, jsonb, text, text)', 'execute') then raise exception 'authenticated executa pc_salvar'; end if;
  if has_table_privilege('authenticated', 'pedidos_compra', 'insert') then raise exception 'authenticated insere'; end if;
  if not has_table_privilege('authenticated', 'pedidos_compra_itens_situacao', 'select') then raise exception 'view sem select'; end if;
  raise notice 'pedido de compra (200) OK';
end $$;
rollback;
