-- 078_auditoria_sentinela_sem.sql
-- Sentinela '__sem__' nas funcoes de auditoria fiscal (p_familia, p_fornecedor
-- e p_cfop_entrada). Destrava o drill dos pares "CFOP -> (sem entrada)", que
-- hoje nem abrem. Espelhar em lib/relatorio-frio-nf.ts.

drop function if exists relatorio_auditoria_fiscal_cfop(bigint, date, date, text, text, text, bigint);
drop function if exists relatorio_auditoria_fiscal_itens(bigint, date, date, text, text, text, text, text, bigint);

create or replace function relatorio_auditoria_fiscal_cfop(
  p_loja_id bigint, p_ini date, p_fim date,
  p_produto text default null, p_familia text default null,
  p_fornecedor text default null, p_local bigint default null
) returns table(cfop_doc text, cfop_entrada text, itens bigint, valor numeric, credita_icms bigint, move_estoque bigint)
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
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_familia is null
         or (p_familia = '__sem__' and p.descricao_familia is null)
         or p.descricao_familia = p_familia)
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
  group by 1, 2
  order by valor desc, cfop_doc, cfop_entrada;
$$;

create or replace function relatorio_auditoria_fiscal_itens(
  p_loja_id bigint, p_ini date, p_fim date,
  p_cfop_doc text default null, p_cfop_entrada text default null, p_fornecedor text default null,
  p_produto text default null, p_familia text default null, p_local bigint default null
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
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    and (p_cfop_doc is null or coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') = p_cfop_doc)
    and (p_cfop_entrada is null
         or (p_cfop_entrada = '__sem__' and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or i.full_object->'itensAjustes'->>'cCFOPEntrada' = p_cfop_entrada)
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_familia is null
         or (p_familia = '__sem__' and p.descricao_familia is null)
         or p.descricao_familia = p_familia)
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
  order by nf.d_emissao_nfe desc, i.id;
$$;
