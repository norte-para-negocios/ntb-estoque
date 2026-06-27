-- B.5.4: Relatorio de Compras (a partir das NFs de entrada e seus itens).
-- Sem custo de sync novo: usa notas_fiscais + nota_fiscal_items + fornecedores.

-- Ranking de fornecedores por valor comprado no periodo
create or replace function compras_ranking_fornecedores(p_loja_id bigint, p_desde date default null)
returns table(codigo_omie bigint, razao_social text, total numeric, qtd_nf bigint, ultima_compra date)
language sql stable security definer
as $$
  select
    nf.n_id_fornecedor as codigo_omie,
    coalesce(max(f.razao_social), max(nf.c_razao_social), '(sem nome)') as razao_social,
    sum(nf.n_valor_nfe)::numeric as total,
    count(*)::bigint as qtd_nf,
    max(nf.d_emissao_nfe) as ultima_compra
  from notas_fiscais nf
  left join fornecedores f on f.loja_id = nf.loja_id and f.codigo_omie = nf.n_id_fornecedor
  where nf.loja_id = p_loja_id
    and nf.deleted_at is null
    and (p_desde is null or nf.d_emissao_nfe >= p_desde)
  group by nf.n_id_fornecedor
  order by total desc nulls last
  limit 100;
$$;

grant execute on function compras_ranking_fornecedores(bigint, date) to authenticated, anon;

-- Precos de compra por produto: ultimo preco, menor/maior historico, medio e qtd de compras.
-- Permite ver se o preco de um insumo subiu (ultimo vs menor).
drop function if exists compras_precos_produtos(bigint, text);
create or replace function compras_precos_produtos(p_loja_id bigint, p_busca text default null)
returns table(
  codigo text, descricao text,
  ultimo_preco numeric, ultima_data date,
  menor_preco numeric, maior_preco numeric, preco_tipico numeric,
  qtd_compras bigint
)
language sql stable security definer
as $$
  with itens as (
    select
      nfi.c_codigo_produto as codigo,
      nfi.c_descricao_produto as descricao,
      nfi.n_preco_unit::numeric as preco,
      nf.d_emissao_nfe as data
    from nota_fiscal_items nfi
    join notas_fiscais nf on nf.id = nfi.nota_fiscal_id and nf.deleted_at is null
    where nfi.loja_id = p_loja_id
      and nfi.n_preco_unit > 0
      and nfi.c_codigo_produto is not null
      and (p_busca is null or nfi.c_descricao_produto ilike '%' || p_busca || '%' or nfi.c_codigo_produto ilike '%' || p_busca || '%')
  ),
  agg as (
    select codigo,
      min(preco) as menor_preco, max(preco) as maior_preco,
      -- mediana: resistente a erros de digitacao (NFs com preco absurdo)
      percentile_cont(0.5) within group (order by preco)::numeric as preco_tipico,
      count(*) as qtd_compras
    from itens group by codigo
  ),
  ult as (
    select distinct on (codigo) codigo, descricao, preco as ultimo_preco, data as ultima_data
    from itens order by codigo, data desc nulls last
  )
  select
    ult.codigo, ult.descricao,
    ult.ultimo_preco, ult.ultima_data,
    agg.menor_preco, agg.maior_preco, round(agg.preco_tipico, 2) as preco_tipico,
    agg.qtd_compras
  from ult join agg on agg.codigo = ult.codigo
  order by agg.qtd_compras desc, ult.descricao
  limit 300;
$$;

grant execute on function compras_precos_produtos(bigint, text) to authenticated, anon;
