-- Teste da migration 242 (pc_importar). Cópia local (… 200, 201, 240, 241, 242). Nunca em produção.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d c2 < scripts/testes-sql/242_importar_pedidos_compra.sql
begin;
do $$
declare v_p bigint; v_o bigint; r jsonb; n int; k text := 'imp:' || repeat('a', 64); k2 text := 'imp:' || repeat('b', 64);
        ok jsonb := '[{"fornecedor_nome":"HORTI","previsao_entrega":"2026-10-25","itens":[{"codigo_produto":951,"quantidade":10,"preco_unitario":5}]},
                      {"fornecedor_nome":"FEIRA","parcelas":[{"dias":30,"percentual":100}],"itens":[{"codigo_produto":951,"quantidade":1},{"codigo_produto":952,"quantidade":2}]}]';
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 242', '00000000000260', 'proprio') returning id into v_p;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 242 O', '00000000000261', 'omie') returning id into v_o;
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (v_p, 951, 'P951', 'TOMATE', 'KG'), (v_p, 952, 'P952', 'CEBOLA', 'KG');

  begin perform pc_importar(v_o, k, ok); raise exception 'loja omie importou'; exception when sqlstate '22023' then null; end;
  begin perform pc_importar(v_p, 'imp:xyz', ok); raise exception 'chave torta'; exception when sqlstate '22023' then null; end;
  begin perform pc_importar(v_p, k, '[]'::jsonb); raise exception 'vazio'; exception when sqlstate '22023' then null; end;

  r := pc_importar(v_p, k, ok, 'u1', 'Ana');
  if (r->>'duplicado')::boolean or jsonb_array_length(r->'pedidos') <> 2 then raise exception 'importar %', r; end if;
  if (select count(*) from pedidos_compra where loja_id = v_p and origem = 'planilha' and etapa = 'rascunho') <> 2 then raise exception 'rascunhos planilha'; end if;
  if (select count(*) from pedidos_compra_itens where loja_id = v_p) <> 3 then raise exception 'itens'; end if;
  -- mesmo arquivo de novo: os mesmos pedidos, nada novo
  r := pc_importar(v_p, k, ok);
  if (r->>'duplicado')::boolean is not true or jsonb_array_length(r->'pedidos') <> 2 then raise exception 'idempotência %', r; end if;
  if (select count(*) from pedidos_compra where loja_id = v_p) <> 2 then raise exception 'duplicou'; end if;

  -- tudo ou nada: o 2º pedido com produto inexistente desfaz o 1º
  begin
    perform pc_importar(v_p, k2, '[{"fornecedor_nome":"A","itens":[{"codigo_produto":951,"quantidade":1}]},{"fornecedor_nome":"B","itens":[{"codigo_produto":999,"quantidade":1}]}]'::jsonb);
    raise exception 'importou com produto inexistente';
  exception when sqlstate '22023' then null; end;
  if (select count(*) from pedidos_compra where loja_id = v_p) <> 2 then raise exception 'meia importação ficou gravada'; end if;
  -- "id" na planilha não edita pedido existente
  r := pc_importar(v_p, k2, jsonb_build_array(jsonb_build_object('id', (select min(id) from pedidos_compra where loja_id = v_p), 'fornecedor_nome', 'C',
         'itens', '[{"codigo_produto":952,"quantidade":1}]'::jsonb)));
  if (select count(*) from pedidos_compra where loja_id = v_p) <> 3 then raise exception 'id da planilha editou em vez de criar'; end if;

  if has_function_privilege('authenticated', 'pc_importar(bigint, text, jsonb, text, text)', 'execute') then raise exception 'grant'; end if;
  raise notice 'importar pedidos (242) OK';
end $$;
rollback;
