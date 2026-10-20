CREATE OR REPLACE FUNCTION public.relatorio_compras_detalhe(p_loja_id bigint, p_ini date, p_fim date, p_familias text[] DEFAULT NULL::text[], p_tipos text[] DEFAULT NULL::text[], p_fornecedor text DEFAULT NULL::text, p_cfops text[] DEFAULT NULL::text[], p_produto text DEFAULT NULL::text, p_local bigint DEFAULT NULL::bigint, p_status text DEFAULT 'CONCLUIDA'::text)
 RETURNS TABLE(data date, mes text, nota text, fornecedor text, tipo text, familia text, produto text, codigo text, ncm text, cfop text, unidade text, qtde numeric, preco_unit numeric, total numeric, valor_estoque numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    nf.d_emissao_nfe as data,
    to_char(nf.d_emissao_nfe, 'YYYY-MM') as mes,
    nf.c_numero_nfe as nota,
    coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
    p.tipo_item as tipo,
    p.descricao_familia as familia,
    i.c_descricao_produto as produto,
    i.c_codigo_produto as codigo,
    i.c_ncm as ncm,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop,
    i.c_unidade_nfe as unidade,
    coalesce(i.n_qtde_nfe, 0)::numeric as qtde,
    coalesce(i.n_preco_unit, 0)::numeric as preco_unit,
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as total,
    custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) as valor_estoque
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and item_movimenta_estoque(i.full_object)
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  order by nf.d_emissao_nfe desc, total desc, i.id;
$function$
;
