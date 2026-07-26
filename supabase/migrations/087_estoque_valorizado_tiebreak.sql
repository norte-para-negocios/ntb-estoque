-- Achado real (revisao da auditoria de relatorios, 2026-07-26): `order by
-- pos.valor_total desc` nao tem criterio de desempate -- em tese, 2 produtos
-- com valor_total EXATAMENTE igual na fronteira de uma pagina (rpcTodos pagina
-- em lotes de 1000 via .range()) poderiam sair em ordem nao-deterministica
-- entre 2 chamadas, causando duplicata ou lacuna na paginacao. Nao se
-- manifestou nos dados reais testados, mas o risco e real (Postgres nao
-- garante ordem estavel sem um tiebreaker explicito). Adiciona
-- `codigo_produto` como segundo criterio, sem mudar nenhum outro
-- comportamento da funcao (mesma logica de 082, so a ordenacao final muda).
drop function if exists relatorio_estoque_valorizado(bigint, text[], text[], bigint[], text);

create or replace function relatorio_estoque_valorizado(
  p_loja_id     bigint,
  p_familia     text[] default null,
  p_tipo        text[] default null,
  p_local       bigint[] default null,
  p_busca       text default null
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
      and (p_local is null or codigo_local_estoque = any(p_local))
  ),
  pos as (
    select
      pe.n_cod_prod,
      sum(pe.n_saldo)          as n_saldo,
      -- Pondera por linha (local): soma de custo x quantidade de cada local,
      -- em vez do maior CMC entre locais vezes a soma total de quantidade.
      sum(pe.n_cmc * pe.n_saldo) as valor_total
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
      and (p_local is null or pe.codigo_local_estoque = any(p_local))
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
    case when pos.n_saldo <> 0 then pos.valor_total / pos.n_saldo else null end as n_cmc,
    p.valor_unitario::numeric                          as n_preco_unitario,
    case
      when p.valor_unitario > 0 and pos.n_saldo <> 0 and (pos.valor_total / pos.n_saldo) > 0
      then round(((p.valor_unitario - (pos.valor_total / pos.n_saldo)) / p.valor_unitario) * 100, 1)
      else null
    end                                                as margem_pct,
    pos.valor_total,
    foto.d                                             as data_foto
  from pos
  join produtos p on p.codigo_produto = pos.n_cod_prod and p.loja_id = p_loja_id
  cross join foto
  where pos.n_saldo > 0
    and pos.valor_total > 0
    and (p_familia is null or p.descricao_familia = any(p_familia))
    and (p_tipo    is null or p.tipo_item          = any(p_tipo))
    and (p_busca   is null or p_busca = ''
         or p.descricao ilike '%' || p_busca || '%'
         or p.codigo    ilike '%' || p_busca || '%')
  order by pos.valor_total desc, p.codigo_produto asc
$$;

revoke execute on function relatorio_estoque_valorizado(bigint, text[], text[], bigint[], text) from public;
revoke execute on function relatorio_estoque_valorizado(bigint, text[], text[], bigint[], text) from anon;
grant  execute on function relatorio_estoque_valorizado(bigint, text[], text[], bigint[], text) to authenticated, service_role;
