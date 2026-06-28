-- B.5.2: Relatório de estoque valorizado (só dados de API, sem upload).
-- Usa a foto mais recente de posicao_estoques para calcular saldo × CMC.
-- Inclui margem bruta estimada usando produtos.valor_unitario (PDV do Omie).

create or replace function relatorio_estoque_valorizado(
  p_loja_id     bigint,
  p_familia     text default null,
  p_tipo        text default null
)
returns table (
  codigo_produto  bigint,
  codigo          text,
  descricao       text,
  descricao_familia text,
  tipo_item       text,
  unidade         text,
  n_saldo         numeric,
  n_cmc           numeric,
  n_preco_unitario numeric,
  margem_pct      numeric,
  valor_total     numeric,
  data_foto       date
)
language sql
stable
security invoker
as $$
  with foto as (
    select max(data_posicao) as d
    from posicao_estoques
    where loja_id = p_loja_id
  ),
  pos as (
    select
      pe.n_cod_prod,
      sum(pe.n_saldo)                                   as n_saldo,
      max(pe.n_cmc) filter (where pe.n_cmc > 0)        as n_cmc
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
    group by pe.n_cod_prod
  )
  select
    p.codigo_produto,
    p.codigo::text,
    p.descricao::text,
    p.descricao_familia::text,
    p.tipo_item::text,
    p.unidade::text,
    pos.n_saldo,
    pos.n_cmc,
    p.valor_unitario::numeric                          as n_preco_unitario,
    case
      when p.valor_unitario > 0 and pos.n_cmc > 0
      then round(((p.valor_unitario - pos.n_cmc) / p.valor_unitario) * 100, 1)
      else null
    end                                                as margem_pct,
    pos.n_cmc * pos.n_saldo                           as valor_total,
    foto.d                                             as data_foto
  from pos
  join produtos p on p.codigo_produto = pos.n_cod_prod and p.loja_id = p_loja_id
  cross join foto
  where pos.n_saldo > 0
    and pos.n_cmc > 0
    and (p_familia is null or p.descricao_familia = p_familia)
    and (p_tipo   is null or p.tipo_item          = p_tipo)
  order by (pos.n_cmc * pos.n_saldo) desc
$$;

revoke execute on function relatorio_estoque_valorizado(bigint, text, text) from public;
revoke execute on function relatorio_estoque_valorizado(bigint, text, text) from anon;
grant  execute on function relatorio_estoque_valorizado(bigint, text, text) to authenticated, service_role;
