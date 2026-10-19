-- Teste da migration 241 (lead time por fornecedor + requisições na entrada prevista). Cópia local (… 200, 201, 240, 241).
-- Nunca em produção. Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d c2 < scripts/testes-sql/241_lead_time_fornecedor.sql
begin;
do $$
declare v_p bigint; v_o bigint; v_forn bigint; v_forn_o bigint; v_comp bigint; j jsonb; l jsonb; r jsonb; v_r1 bigint; v_r2 bigint; v_r3 bigint; v_r4 bigint;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 241', '00000000000250', 'proprio') returning id into v_p;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 241 O', '00000000000251', 'proprio') returning id into v_o;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_p, 1, 'DEPOSITO');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
    (v_p, 901, 'P901', 'TOMATE', 'KG', '01'), (v_p, 902, 'P902', 'CEBOLA', 'KG', '01'), (v_p, 903, 'P903', 'ALHO', 'KG', '01');
  insert into fornecedores (loja_id, codigo_omie, razao_social, cnpj_cpf, origem) values (v_p, 8000000000901, 'HORTI LTDA', '11222333000181', 'proprio') returning id into v_forn;
  insert into fornecedores (loja_id, codigo_omie, razao_social, cnpj_cpf, origem) values (v_o, 8000000000902, 'OUTRO', '99888777000166', 'proprio') returning id into v_forn_o;
  perform registrar_movimento(v_p, 1, 901, 'ENT', 'TESTE', 'e1', 100, 5, null, null, 0, null, null, '2026-09-01');
  perform registrar_movimento(v_p, 1, 902, 'ENT', 'TESTE', 'e2', 100, 5, null, null, 0, null, null, '2026-09-01');
  perform registrar_movimento(v_p, 1, 901, 'SAI', 'VENDA', 's1', 30, null, null, null, 0, null, null, '2026-09-10');
  perform registrar_movimento(v_p, 1, 902, 'SAI', 'VENDA', 's2', 30, null, null, null, 0, null, null, '2026-09-10');
  -- última nota dos dois produtos: HORTI
  insert into compras_proprio (loja_id, origem, numero, fornecedor_cnpj, fornecedor_nome, status, emissao)
    values (v_p, 'manual', 'N1', '11.222.333/0001-81', 'HORTI LTDA', 'lancada', '2026-09-01') returning id into v_comp;
  insert into compras_proprio_itens (compra_id, loja_id, linha, descricao, quantidade, valor_unitario, valor_total, fator, codigo_produto, lancado)
    values (v_comp, v_p, 1, 'TOMATE', 1, 5, 5, 1, 901, true), (v_comp, v_p, 2, 'CEBOLA', 1, 5, 5, 1, 902, true);

  -- 1. função de salvar: fornecedor de outra loja recusado; fora de 1..365 recusado; null apaga
  begin perform fornecedor_lead_time_salvar(v_p, v_forn_o, 5); raise exception 'aceitou fornecedor de outra loja'; exception when sqlstate '22023' then null; end;
  begin perform fornecedor_lead_time_salvar(v_p, v_forn, 0); raise exception 'aceitou 0 dias'; exception when sqlstate '22023' then null; end;
  perform fornecedor_lead_time_salvar(v_p, v_forn, 9, 'u1');
  perform fornecedor_lead_time_salvar(v_p, v_forn, 5, 'u1');
  if (select lead_time_dias from fornecedor_compra_param where fornecedor_id = v_forn) <> 5 then raise exception 'upsert'; end if;
  -- produto 902 tem prazo próprio (2): ganha do fornecedor
  insert into produto_compra_param (loja_id, codigo_produto, lead_time_dias) values (v_p, 902, 2);

  -- 2. requisições: aberta (4 kg) e aprovada (1 cx de 3 kg) contam; recusada e entrega depois da estimativa não; virada em pedido sai daqui
  r := rc_salvar(v_p, '{"itens":[{"codigo_produto":901,"quantidade":4}]}'::jsonb); v_r1 := (r->>'id')::bigint;
  r := rc_salvar(v_p, '{"sugestao_entrega":"2026-10-20","itens":[{"codigo_produto":901,"quantidade":1,"unidade":"CX","fator":3}]}'::jsonb); v_r2 := (r->>'id')::bigint;
  perform rc_acao(v_p, v_r2, 'aprovar');
  r := rc_salvar(v_p, '{"itens":[{"codigo_produto":901,"quantidade":100}]}'::jsonb); perform rc_acao(v_p, (r->>'id')::bigint, 'recusar', null, null, 'não');
  r := rc_salvar(v_p, '{"sugestao_entrega":"2026-12-01","itens":[{"codigo_produto":901,"quantidade":50}]}'::jsonb);
  r := rc_salvar(v_p, '{"itens":[{"codigo_produto":902,"quantidade":7,"fornecedor_nome":"F"}]}'::jsonb); v_r3 := (r->>'id')::bigint;
  perform rc_acao(v_p, v_r3, 'aprovar');
  r := rc_salvar(v_p, '{"itens":[{"codigo_produto":903,"quantidade":2}]}'::jsonb); v_r4 := (r->>'id')::bigint;   -- só a requisição põe o alho na lista

  j := sugestao_compra_proprio(v_p, '2026-09-01', '2026-09-30', '2026-10-17', '2026-10-31');
  select x into l from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 901;
  if (l->>'lead_time')::int <> 5 or l->>'lead_time_origem' <> 'fornecedor' then raise exception 'lead do fornecedor: %', l; end if;
  if (l->>'entrada_requisicoes')::numeric <> 7 then raise exception 'requisições 4 + 3: %', l; end if;
  select x into l from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 902;
  if (l->>'lead_time')::int <> 2 or l->>'lead_time_origem' <> 'produto' then raise exception 'lead do produto ganha: %', l; end if;
  if (l->>'entrada_requisicoes')::numeric <> 7 or (l->>'entrada_pedidos')::numeric <> 0 then raise exception 'cebola antes do pedido: %', l; end if;
  if not exists (select 1 from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 903 and (x->>'entrada_requisicoes')::numeric = 2) then raise exception 'alho só com requisição'; end if;

  -- 3. requisição virou pedido: sai das requisições e entra (uma vez) nos pedidos depois de enviado/aprovado
  r := rc_gerar_pedidos(v_p, array[v_r3], 'teste-241-gerar');
  j := sugestao_compra_proprio(v_p, '2026-09-01', '2026-09-30', '2026-10-17', '2026-10-31');
  select x into l from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 902;
  if (l->>'entrada_requisicoes')::numeric <> 7 or (l->>'entrada_pedidos')::numeric <> 0 then raise exception 'cebola com o pedido em rascunho: %', l; end if;
  perform pc_acao(v_p, (r->'pedidos'->0->>'id')::bigint, 'aprovar');
  j := sugestao_compra_proprio(v_p, '2026-09-01', '2026-09-30', '2026-10-17', '2026-10-31');
  select x into l from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 902;
  if (l->>'entrada_requisicoes')::numeric <> 0 or (l->>'entrada_pedidos')::numeric <> 7 then raise exception 'cebola depois do pedido (sem contar 2x): %', l; end if;

  -- 4. sem prazo nenhum: lead_time nulo, origem nula
  perform fornecedor_lead_time_salvar(v_p, v_forn, null);
  j := sugestao_compra_proprio(v_p, '2026-09-01', '2026-09-30', '2026-10-17', '2026-10-31');
  select x into l from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 901;
  if l->>'lead_time' is not null or l->>'lead_time_origem' is not null then raise exception 'sem prazo: %', l; end if;

  if has_function_privilege('authenticated', 'fornecedor_lead_time_salvar(bigint, bigint, int, text)', 'execute') then raise exception 'authenticated salva prazo'; end if;
  if not has_function_privilege('authenticated', 'sugestao_compra_proprio(bigint, date, date, date, date)', 'execute') then raise exception 'sugestão sem grant'; end if;
  raise notice 'lead time por fornecedor (241) OK';
end $$;
rollback;
