-- Relatório de Compras v3: matriz mensal (linha = dimensão, coluna = mês), como
-- as abas "COMP POR FAM / FORN / PROD" do Ramon. Retorna formato longo
-- (rotulo, mes 'YYYY-MM', valor); o app pivota para colunas mensais no Excel.

create or replace function relatorio_compras_matriz(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familia text default null, p_tipo text default null, p_fornecedor text default null
) returns table(rotulo text, mes text, valor numeric)
language sql stable as $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
      end, ''), 'Sem classificação') as rotulo,
    to_char(nf.d_emissao_nfe, 'YYYY-MM') as mes,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familia is null or p.descricao_familia = p_familia)
    and (p_tipo is null or p.tipo_item = p_tipo)
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
  group by 1, 2;
$$;
