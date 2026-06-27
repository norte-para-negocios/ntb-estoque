-- Retorna produtos ativos da loja que NAO estao no inventario informado.
-- Inclui saldo (foto mais recente de posicao_estoques) e estoque_minimo.
-- Paginavel via p_offset/p_limit. Total via count(*) over().
create or replace function inventario_nao_contados(
  p_inventario_id bigint,
  p_loja_id       bigint,
  p_tipo_item     text    default null,
  p_familia       text    default null,
  p_busca         text    default null,
  p_offset        int     default 0,
  p_limit         int     default 50
) returns table(
  codigo_produto    bigint,
  codigo            text,
  descricao         text,
  tipo_item         text,
  descricao_familia text,
  unidade           text,
  saldo             numeric,
  estoque_minimo    numeric,
  total             bigint
)
language sql stable as $$
  with foto_max as (
    select max(data_posicao) as dp
    from posicao_estoques
    where loja_id = p_loja_id
  ),
  saldos as (
    select n_cod_prod, sum(n_saldo) as saldo
    from posicao_estoques pe, foto_max
    where pe.loja_id = p_loja_id and pe.data_posicao = foto_max.dp
    group by n_cod_prod
  ),
  filtrados as (
    select p.codigo_produto, p.codigo, p.descricao, p.tipo_item, p.descricao_familia, p.unidade,
           coalesce(s.saldo, 0) as saldo, coalesce(p.estoque_minimo, 0) as estoque_minimo
    from produtos p
    left join saldos s on s.n_cod_prod = p.codigo_produto
    where p.loja_id = p_loja_id
      and p.inativo = false
      and not exists (
        select 1 from inventario_items ii
        where ii.inventario_id = p_inventario_id
          and ii.produto_codigo_produto = p.codigo_produto
      )
      and (p_tipo_item is null or p.tipo_item = p_tipo_item)
      and (p_familia   is null or p.descricao_familia = p_familia)
      and (p_busca     is null
           or p.descricao ilike '%' || p_busca || '%'
           or p.codigo    ilike '%' || p_busca || '%')
  )
  select
    f.codigo_produto, f.codigo, f.descricao, f.tipo_item, f.descricao_familia, f.unidade,
    f.saldo, f.estoque_minimo,
    count(*) over() as total
  from filtrados f
  order by f.descricao
  offset p_offset limit p_limit;
$$;

-- Retorna cobertura de contagem por periodo (dia/semana/mes).
-- Para cada grupo: qtd inventarios, produtos unicos contados e total de produtos ativos da loja.
create or replace function inventario_cobertura(
  p_loja_id bigint,
  p_ini     date,
  p_fim     date,
  p_periodo text default 'dia'   -- 'dia' | 'semana' | 'mes'
) returns table(
  periodo_inicio  date,
  qtd_inventarios bigint,
  produtos_contados bigint,
  total_produtos  bigint
)
language sql stable as $$
  with trunc_unit as (
    select case p_periodo
      when 'semana' then 'week'
      when 'mes'    then 'month'
      else               'day'
    end as u
  ),
  grupos as (
    select
      date_trunc((select u from trunc_unit), inv.data::date)::date as per,
      count(distinct inv.id) as qtd_inv,
      count(distinct ii.produto_codigo_produto) as prod_contados
    from inventarios inv
    left join inventario_items ii
      on ii.inventario_id = inv.id and ii.loja_id = inv.loja_id
    where inv.loja_id = p_loja_id
      and inv.data::date >= p_ini
      and inv.data::date <= p_fim
    group by 1
  ),
  total as (
    select count(*) as total_prod
    from produtos
    where loja_id = p_loja_id and inativo = false
  )
  select
    g.per as periodo_inicio,
    g.qtd_inv as qtd_inventarios,
    g.prod_contados as produtos_contados,
    t.total_prod as total_produtos
  from grupos g, total t
  order by g.per desc;
$$;
