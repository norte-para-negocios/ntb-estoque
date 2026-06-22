-- Relatório de Compras v2: filtros (família / tipo / fornecedor) nas funções de
-- total e abertura, e nova função de DETALHE (uma linha por item de NF) para o
-- Excel com AutoFiltro — a pessoa fatia por mês/tipo/família/fornecedor/CFOP na mão.

drop function if exists relatorio_compras_total(bigint, date, date);
drop function if exists relatorio_compras_dim(bigint, date, date, text);

-- Total geral do período (com filtros opcionais).
create or replace function relatorio_compras_total(
  p_loja_id bigint, p_ini date, p_fim date,
  p_familia text default null, p_tipo text default null, p_fornecedor text default null
) returns table(valor numeric, n_notas bigint)
language sql stable as $$
  select
    coalesce(sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0)), 0)::numeric,
    count(distinct nf.id)::bigint
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familia is null or p.descricao_familia = p_familia)
    and (p_tipo is null or p.tipo_item = p_tipo)
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%');
$$;

-- Abertura por dimensão (com filtros opcionais).
create or replace function relatorio_compras_dim(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familia text default null, p_tipo text default null, p_fornecedor text default null
) returns table(rotulo text, valor numeric, itens bigint)
language sql stable as $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
      end, ''), 'Sem classificação') as rotulo,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*)::bigint as itens
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familia is null or p.descricao_familia = p_familia)
    and (p_tipo is null or p.tipo_item = p_tipo)
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
  group by 1
  order by valor desc;
$$;

-- Detalhe: uma linha por item de NF de entrada, com todas as dimensões em coluna.
create or replace function relatorio_compras_detalhe(
  p_loja_id bigint, p_ini date, p_fim date,
  p_familia text default null, p_tipo text default null, p_fornecedor text default null
) returns table(
  data date, mes text, nota text, fornecedor text, tipo text, familia text,
  produto text, codigo text, ncm text, cfop text, unidade text,
  qtde numeric, preco_unit numeric, total numeric
)
language sql stable as $$
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
    i.c_cfop as cfop,
    i.c_unidade_nfe as unidade,
    coalesce(i.n_qtde_nfe, 0)::numeric as qtde,
    coalesce(i.n_preco_unit, 0)::numeric as preco_unit,
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as total
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familia is null or p.descricao_familia = p_familia)
    and (p_tipo is null or p.tipo_item = p_tipo)
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
  order by nf.d_emissao_nfe desc, total desc;
$$;
