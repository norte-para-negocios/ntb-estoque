-- Teste da migration 350 (devolução ao fornecedor reabre o saldo a receber do pedido). Loja 19 "ZZ NORTE ERP LAB"
-- (proprio, is_test), TUDO dentro de BEGIN … ROLLBACK. Rodar com scripts/testes-sql/350_rodar.sh.
-- Caminho real: gravar_nota_sefaz → registrar_compra_sefaz → pc_vincular_nota → lancar_compra → devolucao_fornecedor_registrar
-- → devolucao_fornecedor_cancelar. Espera: NOTICE "350 DEVOLUCAO REABRE PEDIDO OK". Nada fala com Omie nem com a SEFAZ.

do $$
declare
  L constant bigint := 19; LOC constant bigint := 8000000000019; PROD constant bigint := 8000000000258;
  CNPJ constant text := '99350000000191';
  CH constant text := '29261199350000019155001' || lpad('350001', 21, '0');
  r jsonb; v_nota bigint; v_comp bigint; v_ped bigint; v_item bigint; v_ci bigint; v_dev bigint; s record;
begin
  assert (select modo_estoque = 'proprio' and is_test from lojas where id = L), 'loja 19 tem de ser a loja-laboratório própria';

  -- nota de 10 unidades do fornecedor
  r := gravar_nota_sefaz(L, jsonb_build_object('chave', CH, 'numero', '000350', 'serie', '1', 'modelo', '55', 'emissao', '2026-11-05',
         'valor', 100, 'fornecedor_cnpj', CNPJ, 'fornecedor_nome', 'ATACADO TESTE 350 LTDA', 'ambiente', '2', 'etapa', '40'), '[]'::jsonb);
  v_nota := (r->>'nota_id')::bigint;
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', L, 'chave_acesso', CH, 'numero', '000350', 'serie', '1', 'fornecedor_cnpj', CNPJ,
         'fornecedor_nome', 'ATACADO TESTE 350 LTDA', 'emissao', '2026-11-05', 'nota_fiscal_id', v_nota,
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'c_prod', 'A350', 'descricao', 'ACUCAR 350', 'quantidade', 10,
            'valor_unitario', 10, 'valor_total', 100, 'codigo_produto', PROD, 'fator', 1))), LOC);
  v_comp := (r->>'compra_id')::bigint;

  -- pedido aprovado de 10 unidades, ligado à nota
  insert into pedidos_compra (loja_id, numero, etapa, fornecedor_nome, fornecedor_cnpj)
  values (L, (select coalesce(max(numero), 0) + 1 from pedidos_compra where loja_id = L), 'aprovado', 'ATACADO TESTE 350 LTDA', CNPJ)
  returning id into v_ped;
  insert into pedidos_compra_itens (pedido_id, loja_id, linha, codigo_produto, descricao, quantidade, preco_unitario)
  values (v_ped, L, 1, PROD, 'ACUCAR 350', 10, 10) returning id into v_item;
  r := pc_vincular_nota(L, v_ped, v_comp, null, null);
  assert (r->>'vinculados')::int = 1, 'vínculo: ' || r::text;

  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  assert r->>'status' = 'lancada', 'entrada: ' || r::text;
  select * into s from pedidos_compra_itens_situacao where id = v_item;
  assert s.recebido = 10 and s.vinculado = 10 and s.devolvido = 0, 'antes da devolução: ' || row_to_json(s)::text;

  -- devolve 4: o pedido volta a ter 4 a receber
  select id into v_ci from compras_proprio_itens where compra_id = v_comp and linha = 1;
  r := devolucao_fornecedor_registrar(L, v_comp, jsonb_build_array(jsonb_build_object('compra_item_id', v_ci, 'quantidade', 4)),
         'avariado no transporte', null, 'teste 350', 'teste-350-' || v_comp);
  v_dev := (r->>'id')::bigint;
  select * into s from pedidos_compra_itens_situacao where id = v_item;
  assert s.recebido = 6 and s.vinculado = 6 and s.devolvido = 4, 'depois da devolução: ' || row_to_json(s)::text;
  assert s.quantidade_base - s.recebido = 4, 'saldo a receber reaberto';

  -- a próxima nota do fornecedor cai neste item (ainda tem saldo) e o pedido pode ser cancelado (não está mais 100% recebido)
  assert exists (select 1 from pedidos_compra_itens_situacao where pedido_id = v_ped and recebido + 0.000001 < quantidade_base), 'pedido reaberto';

  -- cancelar a devolução fecha o saldo de novo
  r := devolucao_fornecedor_cancelar(L, v_dev, null, 'teste 350', 'teste');
  select * into s from pedidos_compra_itens_situacao where id = v_item;
  assert s.recebido = 10 and s.vinculado = 10 and s.devolvido = 0, 'devolução cancelada: ' || row_to_json(s)::text;

  -- colunas antigas da view com o mesmo nome e ordem (a 321, a 241 e o app leem por nome)
  assert (select array_agg(attname::text order by attnum) from pg_attribute where attrelid = 'public.pedidos_compra_itens_situacao'::regclass and attnum > 0)
       = array['id','pedido_id','loja_id','linha','codigo_produto','descricao','unidade','fator','quantidade','preco_unitario',
               'codigo_local_estoque','obs','quantidade_base','preco_base','vinculado','recebido','devolvido'], 'colunas da view';

  raise notice '350 DEVOLUCAO REABRE PEDIDO OK';
end $$;
