-- Item #14 da reuniao 2026-07-27: Ramon pediu uma visao de "posicao de estoque"
-- que mostre saldo por local + data do ultimo inventario, pra identificar
-- produtos sem contagem ha muito tempo. Extensao aditiva do Estoque Valorizado
-- (RPC nova, a existente nao muda) -- ver
-- docs/superpowers/plans/2026-07-28-estoque-valorizado-por-local-cobertura.md.
--
-- Diferenca chave pra relatorio_estoque_valorizado (087): aqui NAO agrega por
-- produto (1 linha por produto+local, nao soma entre locais), e junta um CTE
-- que calcula max(inventarios.data) por produto+local via inventario_items.

create index if not exists idx_inventario_items_produto
  on inventario_items (produto_codigo_produto);

create index if not exists idx_inventarios_loja_local
  on inventarios (loja_id, codigo_local_estoque);

create or replace function relatorio_estoque_valorizado_local(
  p_loja_id     bigint,
  p_familia     text[] default null,
  p_tipo        text[] default null,
  p_local       bigint[] default null,
  p_busca       text default null
)
returns table (
  codigo_produto        bigint,
  codigo                text,
  descricao             text,
  descricao_familia     text,
  tipo_item             text,
  unidade               text,
  codigo_local_estoque  bigint,
  local_descricao       text,
  n_saldo               numeric,
  n_cmc                 numeric,
  valor_total           numeric,
  data_foto             date,
  data_ultimo_inventario date
)
language sql
stable
security invoker
as $$
  with foto as (
    select max(data_posicao) as d
    from posicao_estoques
    where loja_id = p_loja_id
      and (p_local is null or codigo_local_estoque = any(p_local))
  ),
  pos as (
    select
      pe.n_cod_prod,
      pe.codigo_local_estoque,
      pe.n_saldo,
      pe.n_cmc,
      pe.n_cmc * pe.n_saldo as valor_total
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
      and (p_local is null or pe.codigo_local_estoque = any(p_local))
  ),
  ultimos as (
    select
      ii.produto_codigo_produto as n_cod_prod,
      i.codigo_local_estoque,
      max(i.data)::date as data_ultimo_inventario
    from inventario_items ii
    join inventarios i on i.id = ii.inventario_id
    where i.loja_id = p_loja_id
    group by ii.produto_codigo_produto, i.codigo_local_estoque
  )
  select
    p.codigo_produto,
    p.codigo::text,
    p.descricao::text,
    p.descricao_familia::text,
    p.tipo_item::text,
    p.unidade::text,
    pos.codigo_local_estoque,
    le.descricao::text as local_descricao,
    pos.n_saldo,
    pos.n_cmc,
    pos.valor_total,
    foto.d as data_foto,
    u.data_ultimo_inventario
  from pos
  join produtos p on p.codigo_produto = pos.n_cod_prod and p.loja_id = p_loja_id
  left join local_estoques le
    on le.codigo_local_estoque = pos.codigo_local_estoque and le.loja_id = p_loja_id
  left join ultimos u
    on u.n_cod_prod = pos.n_cod_prod and u.codigo_local_estoque = pos.codigo_local_estoque
  cross join foto
  where pos.n_saldo > 0
    and pos.valor_total > 0
    and (p_familia is null or p.descricao_familia = any(p_familia))
    and (p_tipo    is null or p.tipo_item          = any(p_tipo))
    and (p_busca   is null or p_busca = ''
         or p.descricao ilike '%' || p_busca || '%'
         or p.codigo    ilike '%' || p_busca || '%')
  order by pos.valor_total desc, p.codigo_produto asc, pos.codigo_local_estoque asc
$$;

revoke execute on function relatorio_estoque_valorizado_local(bigint, text[], text[], bigint[], text) from public;
revoke execute on function relatorio_estoque_valorizado_local(bigint, text[], text[], bigint[], text) from anon;
grant  execute on function relatorio_estoque_valorizado_local(bigint, text[], text[], bigint[], text) to authenticated, service_role;
