-- Teste da migration 201 (dados da sugestão de compra), os dois modos. Cópia local (esquema até a 186 + 200 + 201).
-- Nunca em produção. Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d fasec < scripts/testes-sql/201_sugestao_compra.sql
begin;
do $$
declare v_p bigint; v_o bigint; j jsonb; l jsonb; r jsonb; v_mov bigint; v_comp bigint; v_ped bigint; v_nf bigint;
begin
  -- ---------- loja própria ----------
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 201 P', '00000000000011', 'proprio') returning id into v_p;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_p, 1, 'DEPOSITO'), (v_p, 2, 'BAR');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
    (v_p, 701, 'P701', 'TOMATE', 'KG', '01'), (v_p, 702, 'P702', 'MOLHO', 'KG', '04'), (v_p, 703, 'P703', 'PARADO', 'UN', '00'),
    (v_p, 704, 'P704', 'INATIVO', 'UN', '00');
  update produtos set inativo = true where loja_id = v_p and codigo_produto = 704;
  perform registrar_movimento(v_p, 1, 701, 'ENT', 'TESTE', 'e1', 100, 5, null, null, 0, null, null, '2026-09-01');
  perform registrar_movimento(v_p, 1, 704, 'ENT', 'TESTE', 'e4', 5, 1, null, null, 0, null, null, '2026-09-01');
  perform registrar_movimento(v_p, 1, 701, 'SAI', 'VENDA', 's1', 30, null, null, null, 0, null, null, '2026-09-10');
  perform registrar_movimento(v_p, 1, 701, 'AJU', 'AJUSTE', 'a1', -6, null, null, null, 0, null, null, '2026-09-15');
  r := registrar_movimento(v_p, 1, 701, 'SAI', 'VENDA', 's2', 10, null, null, null, 0, null, null, '2026-09-20');
  perform estornar_movimento((r->>'id')::bigint, null, 'venda cancelada');                -- não conta como consumo
  perform registrar_movimento(v_p, 1, 701, 'SAI', 'VENDA', 's3', 4, null, null, null, 0, null, null, '2026-10-02');  -- fora do período
  perform transferir_estoque(v_p, 1, 2, 701, 20, 't1', null, null);                       -- transferência não é consumo
  update estoque_saldos set minimo = 15 where loja_id = v_p and codigo_produto = 701 and codigo_local_estoque = 1;
  update estoque_saldos set minimo = 5 where loja_id = v_p and codigo_produto = 701 and codigo_local_estoque = 2;
  insert into estoque_saldos (loja_id, codigo_local_estoque, codigo_produto, saldo, minimo) values (v_p, 1, 703, 0, 2);
  insert into produto_compra_param (loja_id, codigo_produto, lead_time_dias) values (v_p, 701, 3);
  -- nota pendente (6 kg) vinculada a um pedido de 10 kg: pedido conta só 4 (o resto já está na nota)
  insert into compras_proprio (loja_id, origem, numero, fornecedor_cnpj, fornecedor_nome, status, emissao)
    values (v_p, 'manual', 'N1', '11222333000181', 'HORTI', 'pendente', '2026-10-18') returning id into v_comp;
  insert into compras_proprio_itens (compra_id, loja_id, linha, descricao, quantidade, valor_unitario, valor_total, fator, codigo_produto)
    values (v_comp, v_p, 1, 'TOMATE', 6, 5.5, 33, 1, 701);
  r := pc_salvar(v_p, '{"fornecedor_nome":"HORTI","fornecedor_cnpj":"11222333000181","previsao_entrega":"2026-10-25","itens":[{"codigo_produto":701,"quantidade":10,"preco_unitario":5}]}'::jsonb);
  v_ped := (r->>'id')::bigint;
  perform pc_acao(v_p, v_ped, 'aprovar');
  perform pc_vincular_nota(v_p, v_ped, v_comp);
  -- pedido com entrega depois do fim da estimativa não entra
  r := pc_salvar(v_p, '{"fornecedor_nome":"HORTI","previsao_entrega":"2026-12-01","itens":[{"codigo_produto":701,"quantidade":50}]}'::jsonb);
  perform pc_acao(v_p, (r->>'id')::bigint, 'aprovar');
  -- OP aberta de 3 kg de molho que consome 2 kg de tomate
  insert into ordens_producao (loja_id, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao, concluida, full_object)
    values (v_p, 702, 3, '2026-10-20', false, '{"itensDetalhes":[{"nIdProdutoMalha":701,"nQtde":2,"cUtilizarDoEstoque":"S"}]}');
  insert into fichas_tecnicas (loja_id, codigo_produto, versao, rendimento) values (v_p, 702, 1, 1);

  j := sugestao_compra_proprio(v_p, '2026-09-01', '2026-09-30', '2026-10-17', '2026-10-31');
  select x into l from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 701;
  if (l->>'consumo_total')::numeric <> 36 then raise exception 'consumo próprio (30 + 6, sem estorno, sem transferência): %', l; end if;
  if (l->>'estoque_atual')::numeric <> 60 then raise exception 'estoque: %', l; end if;
  if (l->>'estoque_minimo')::numeric <> 20 then raise exception 'minimo soma dos locais: %', l; end if;
  if (l->>'lead_time')::int <> 3 then raise exception 'lead: %', l; end if;
  if (l->>'entrada_nf')::numeric <> 6 or (l->>'entrada_pedidos')::numeric <> 4 then raise exception 'entradas (sem contar 2x): %', l; end if;
  if (l->>'consumo_ops')::numeric <> 2 then raise exception 'consumo ops: %', l; end if;
  if l->>'fornecedor_nome' <> 'HORTI' or (l->>'ultimo_custo')::numeric <> 5.5 then raise exception 'fornecedor: %', l; end if;
  select x into l from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 702;
  if (l->>'entrada_ops')::numeric <> 3 or (l->>'tem_ficha')::boolean is not true then raise exception 'molho: %', l; end if;
  if not exists (select 1 from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 703) then raise exception 'parado com mínimo sumiu'; end if;
  if exists (select 1 from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 704) then raise exception 'inativo apareceu'; end if;

  -- ---------- loja Omie ----------
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 201 O', '00000000000012', 'omie') returning id into v_o;
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, full_object) values
    (v_o, 801, '90001', 'AGUA', 'UN', '00', '{"lead_time":0}'), (v_o, 802, '90599', 'CAFE', 'UN', '04', '{"lead_time":2}');
  insert into movimentos_historico (loja_id, cod_prod, data, entradas, saidas) values
    (v_o, 801, '2026-09-05', 0, 600), (v_o, 801, '2026-09-25', 10, 546), (v_o, 801, '2026-10-01', 0, 99);
  insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, n_saldo, estoque_minimo) values
    (v_o, 0, 801, '2026-10-17', 0, 120), (v_o, 11, 801, '2026-10-17', 147.5, 0), (v_o, 12, 801, '2026-10-17', 3, 0),
    (v_o, 11, 801, '2026-10-16', 999, 0), (v_o, 0, 801, '2026-10-18', 0, 120);  -- foto de 18 só com sentinela: vale a de 17
  insert into notas_fiscais (loja_id, n_id_receb, c_etapa, d_emissao_nfe, c_razao_social, n_id_fornecedor, full_object)
    values (v_o, 'R1', '40', '2026-10-15', 'DISTRIBUIDORA', 55, '{}') returning id into v_nf;
  insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_produto, n_qtde_nfe, n_preco_unit, v_total_item, full_object)
    values (v_o, v_nf, 801, 7, 20.9, 146.3, '{"itensAjustes":{"nQtdeRecebida":84}}');
  insert into notas_fiscais (loja_id, n_id_receb, c_etapa, d_emissao_nfe, c_razao_social, full_object)
    values (v_o, 'R2', '40', '2026-10-16', 'CANCELADA', '{"infoCadastro":{"cCancelada":"S"}}') returning id into v_nf;
  insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_produto, n_qtde_nfe, n_preco_unit, full_object) values (v_o, v_nf, 801, 100, 1, '{}');
  insert into notas_fiscais (loja_id, n_id_receb, c_etapa, d_emissao_nfe, c_razao_social, full_object)
    values (v_o, 'R3', '60', '2026-10-01', 'ANTIGA', '{}') returning id into v_nf;
  insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_produto, n_qtde_nfe, n_preco_unit, full_object)
    values (v_o, v_nf, 801, 120, 1.5, '{"itensAjustes":{"nQtdeRecebida":120}}');
  insert into ordens_producao (loja_id, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao, concluida)
    values (v_o, 802, 10, '2026-10-17', false), (v_o, 802, 5, '2026-10-10', true);

  j := sugestao_compra_omie(v_o, '2026-09-01', '2026-09-30', '2026-10-17', '2026-10-31');
  select x into l from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 801;
  if (l->>'consumo_total')::numeric <> 1146 then raise exception 'consumo omie: %', l; end if;
  if (l->>'estoque_atual')::numeric <> 150.5 or (l->>'estoque_minimo')::numeric <> 120 then raise exception 'foto: %', l; end if;
  if (l->>'entrada_nf')::numeric <> 84 then raise exception 'nota pendente em unidade de estoque (sem a cancelada): %', l; end if;
  if (l->>'lead_time')::int <> 0 then raise exception 'lead omie: %', l; end if;
  if l->>'fornecedor_nome' <> 'DISTRIBUIDORA' or (l->>'ultimo_custo')::numeric <> round(146.3 / 84, 6) then raise exception 'ult omie: %', l; end if;
  select x into l from jsonb_array_elements(j) x where (x->>'codigo_produto')::bigint = 802;
  if (l->>'entrada_ops')::numeric <> 10 or (l->>'lead_time')::int <> 2 then raise exception 'cafe: %', l; end if;

  -- o modo não se mistura: a função do próprio na loja omie não acha ledger (e vice-versa)
  if jsonb_array_length(sugestao_compra_proprio(v_o, '2026-09-01', '2026-09-30', '2026-10-17', '2026-10-31')) <> 1 then
    raise exception 'proprio na loja omie deveria só ver a OP aberta';
  end if;
  raise notice 'sugestão de compra (201) OK';
end $$;
rollback;
