-- Teste da migration 186 (CT-e de frete no custo do item). Cópia local com o esquema público de produção + Fase A
-- (175–183) + 184 + 185 + 186. Nunca em produção. Valores: NF 131055 (CRBS) + CT-e de 90,56 só para ela (HIPÓTESE N8).

create or replace function pg_temp.compra_sefaz(p_loja bigint, p_chave text, p_itens jsonb, p_local bigint) returns bigint language plpgsql as $$
declare g jsonb; r jsonb; v_nitens jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('seq', (x->>'linha')::int, 'c_prod', x->>'c_prod', 'descricao', x->>'descricao',
           'qtde', (x->>'quantidade')::numeric, 'unidade', 'CX', 'preco_unit', (x->>'valor_unitario')::numeric, 'desconto', 0, 'frete', 0,
           'total', (x->>'valor_total')::numeric, 'full_object', jsonb_build_object('itensCabec', jsonb_build_object('nSequencia', (x->>'linha')::int)))), '[]')
    into v_nitens from jsonb_array_elements(p_itens) x;
  g := gravar_nota_sefaz(p_loja, jsonb_build_object('chave', p_chave, 'numero', right(p_chave, 9), 'serie', '1', 'modelo', '55', 'emissao', '2026-10-19',
         'valor', 922.63, 'fornecedor_nome', 'CRBS S/A', 'fornecedor_cnpj', '99111222000149', 'ambiente', '1',
         'full_object', '{"infoCadastro":{"cRecebido":"N"},"sefaz":{"alertas":[]}}'::jsonb), v_nitens);
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', p_loja, 'chave_acesso', p_chave, 'nota_fiscal_id', g->>'nota_id', 'numero', right(p_chave, 9),
         'fornecedor_cnpj', '99111222000149', 'fornecedor_nome', 'CRBS S/A', 'itens', p_itens), p_local);
  return (r->>'compra_id')::bigint;
end $$;

do $$
declare
  v_loja bigint; BAR bigint := 2746972551; v_a bigint; v_b bigint; v_cte bigint; r jsonb; v numeric; fo jsonb; n int; msg text;
  itens jsonb;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 186', '66764497000122', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, BAR, '01 - BAR');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values
    (v_loja, 1001, 'AGUA', 'AGUA', 'UN'), (v_loja, 1002, 'CORONA', 'CORONA', 'UN'), (v_loja, 1003, 'TONICA', 'TONICA', 'UN');
  itens := jsonb_build_array(
    jsonb_build_object('linha', 1, 'quantidade', 10, 'valor_unitario', 16.299516, 'valor_total', 163, 'fator', 12, 'codigo_produto', 1001,
      'valor_total_item', 176.41, 'outras_valor', 13.41, 'custo_flags', 'NNNNNNNN', 'origem_flags', 'regra'),
    jsonb_build_object('linha', 2, 'quantidade', 4, 'valor_unitario', 158.149101, 'valor_total', 632.60, 'fator', 24, 'codigo_produto', 1002,
      'valor_total_item', 706.35, 'ipi_valor', 20.04, 'outras_valor', 53.71, 'custo_flags', 'NNNNNNSN', 'origem_flags', 'manual'),
    jsonb_build_object('linha', 3, 'quantidade', 1, 'valor_unitario', 36.07555, 'valor_total', 36.08, 'fator', 12, 'codigo_produto', 1003,
      'valor_total_item', 39.87, 'ipi_valor', 0.76, 'outras_valor', 3.03, 'custo_flags', 'SSSSSSNS', 'origem_flags', 'manual'));
  v_a := pg_temp.compra_sefaz(v_loja, '29260999111222000149550220001310551123456781', itens, BAR);
  insert into compras_proprio_cte (loja_id, chave, numero, valor, icms, origem) values (v_loja, '29261011222333000144570010000043211112233440', '4321', 90.56, 8.4, 'xml') returning id into v_cte;

  -- (c) Σ do rateio ≠ valor do CT-e
  begin
    perform vincular_cte_compra(v_loja, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_a, 'valor', 80)), 'gerente');
    raise exception '(c) rateio errado aceito';
  exception when sqlstate '22023' then null; end;

  -- (a) liga e reparte nos itens pelo valor líquido
  r := vincular_cte_compra(v_loja, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_a, 'valor', 90.56)), 'gerente');
  if (r->>'ok')::boolean is not true then raise exception '(a) %', r; end if;
  select array_agg(frete_cte order by linha)::text into msg from compras_proprio_itens where compra_id = v_a;
  if msg <> '{17.7500,68.8800,3.9300}' then raise exception '(a) frete_cte %', msg; end if;
  select percentual into v from compras_proprio_cte_compra where cte_id = v_cte and compra_id = v_a;
  if v <> 100 then raise exception '(a) percentual %', v; end if;
  select nfi.full_object into fo from nota_fiscal_items nfi join compras_proprio c on c.nota_fiscal_id = nfi.nota_fiscal_id where c.id = v_a and nfi.n_sequencia = 2;
  if (fo->'sefaz'->>'freteCte')::numeric <> 68.88 then raise exception '(a) projeção %', fo; end if;
  if not exists (select 1 from compras_proprio_eventos where compra_id = v_a and tipo = 'cte_vinculado') then raise exception '(a) sem evento'; end if;
  -- ligar de novo (mesmo CT-e) não duplica
  perform vincular_cte_compra(v_loja, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_a, 'valor', 90.56)), 'gerente');
  select sum(frete_cte) into v from compras_proprio_itens where compra_id = v_a;
  if v <> 90.56 then raise exception '(a) religar duplicou: %', v; end if;

  -- (d) desligar zera; ligar de volta e lançar: CT-e só entra com Frete = S
  r := desvincular_cte_compra(v_loja, v_cte, 'gerente');
  select sum(frete_cte) into v from compras_proprio_itens where compra_id = v_a;
  if v <> 0 then raise exception '(d) frete_cte depois de desligar %', v; end if;
  if exists (select 1 from compras_proprio_cte_compra where cte_id = v_cte) then raise exception '(d) vínculo ficou'; end if;
  perform vincular_cte_compra(v_loja, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_a, 'valor', 90.56)), 'gerente');
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_a), BAR, null);
  if r->>'status' <> 'lancada' then raise exception '(a) lançamento %', r; end if;
  select custo_unitario into v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1002;
  if v <> 7.307083 then raise exception '(a) corona com CT-e %', v; end if;
  select custo_unitario into v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1001;
  if v <> 1.358333 then raise exception '(a) água %', v; end if;
  select custo_unitario into v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1003;
  if v <> 3.3225 then raise exception '(a) tônica %', v; end if;

  -- (b) CT-e em compra com item lançado é recusado (ligar e desligar)
  begin
    perform vincular_cte_compra(v_loja, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_a, 'valor', 90.56)), 'gerente');
    raise exception '(b) aceitou compra lançada';
  exception when sqlstate '22023' then
    get stacked diagnostics msg = message_text;
    if msg not like 'A nota % já entrou no estoque: desfaça a entrada, ligue o CT-e e confirme de novo.' then raise exception '(b) mensagem: %', msg; end if;
  end;
  begin
    perform desvincular_cte_compra(v_loja, v_cte, 'gerente');
    raise exception '(b) desligou de compra lançada';
  exception when sqlstate '22023' then null; end;

  -- CT-e de duas notas: rateio pelo valor da nota (o servidor manda os valores; a função confere a soma e grava o %)
  v_b := pg_temp.compra_sefaz(v_loja, '29260999111222000149550220001310591123456789', jsonb_build_array(
    jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 300, 'valor_total', 300, 'codigo_produto', 1001, 'valor_total_item', 300, 'custo_flags', 'NNNNNNSN')), BAR);
  insert into compras_proprio_cte (loja_id, valor, origem) values (v_loja, 29.44, 'manual') returning id into v_cte;
  perform vincular_cte_compra(v_loja, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_b, 'valor', 29.44)), null);
  select frete_cte into v from compras_proprio_itens where compra_id = v_b;
  if v <> 29.44 then raise exception 'nota B: %', v; end if;
  -- compra de outra loja recusada
  begin
    perform vincular_cte_compra(v_loja + 999999, v_cte, jsonb_build_array(jsonb_build_object('compra_id', v_b, 'valor', 29.44)), null);
    raise exception 'outra loja aceita';
  exception when sqlstate '22023' then null; end;
  raise notice '186 OK';
end $$;
