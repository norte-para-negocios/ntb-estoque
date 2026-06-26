-- Fix: relatorio_auditoria_fiscal_cfop e relatorio_auditoria_fiscal_itens
-- incluiam NFs canceladas e NFs pendentes (sem filtro c_etapa = '60').
-- Agora filtra apenas NFs autorizadas (c_etapa = '60') e nao canceladas.

create or replace function relatorio_auditoria_fiscal_cfop(
  p_loja_id bigint, p_ini date, p_fim date
) returns table(
  cfop_doc text, cfop_entrada text, itens bigint, valor numeric,
  credita_icms bigint, move_estoque bigint
)
language sql stable as $$
  select
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    count(*)::bigint as itens,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*) filter (
      where coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S'
    )::bigint as credita_icms,
    count(*) filter (
      where coalesce(i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') <> 'S'
    )::bigint as move_estoque
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
  group by 1, 2
  order by valor desc, cfop_doc, cfop_entrada;
$$;

create or replace function relatorio_auditoria_fiscal_itens(
  p_loja_id bigint, p_ini date, p_fim date,
  p_cfop_doc text default null, p_cfop_entrada text default null, p_fornecedor text default null
) returns table(
  data date, nota text, fornecedor text, produto text, codigo text,
  cfop_doc text, cfop_entrada text, cst_icms text, origem text,
  credita_icms boolean, move_estoque boolean, valor numeric, item_id bigint
)
language sql stable as $$
  select
    nf.d_emissao_nfe as data,
    nf.c_numero_nfe as nota,
    coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
    i.c_descricao_produto as produto,
    i.c_codigo_produto as codigo,
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    i.full_object->'itensICMS'->>'cSitTrib' as cst_icms,
    i.full_object->'itensICMS'->>'cOrigem' as origem,
    (coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S') as credita_icms,
    (coalesce(i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') <> 'S') as move_estoque,
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    i.id as item_id
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    and (p_cfop_doc is null or coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') = p_cfop_doc)
    and (p_cfop_entrada is null or i.full_object->'itensAjustes'->>'cCFOPEntrada' = p_cfop_entrada)
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
  order by nf.d_emissao_nfe desc, i.id;
$$;
