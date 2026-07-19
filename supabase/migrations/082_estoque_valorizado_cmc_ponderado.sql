-- Auditoria pos-incidente do relatorio Estoque Valorizado (2026-07-19).
-- Achado real: quando o mesmo produto tem linhas de posicao_estoques com CMC
-- DIFERENTE em locais de estoque distintos (ex.: local A com CMC 0,07 e local
-- B com CMC 34,90 pro mesmo produto, no mesmo dia -- caso real na loja 3), a
-- funcao calculava valor_total = MAX(n_cmc) * SOMA(n_saldo), ou seja, aplicava
-- o MAIOR custo unitario encontrado em qualquer local sobre a quantidade
-- TOTAL somada de todos os locais. Isso superestima o valor sempre que ha
-- divergencia de CMC entre locais -- conferido com SQL direto: loja 3 saia
-- 15,3% mais alta (R$1.096.423 vs R$951.090 correto), loja 2 saia 4,25% mais
-- alta, loja 6 e 7 tambem superestimadas; so a loja 5 tinha divergencia
-- desprezivel nesta foto. Corrigido ponderando por linha: valor_total agora e
-- SOMA(n_cmc * n_saldo) por local (nao MAX(cmc) vezes soma de saldo), e o CMC
-- exibido na coluna vira a media ponderada (valor_total / n_saldo) em vez do
-- maior CMC entre locais -- mesma logica de margem_pct, agora sobre o CMC
-- ponderado.
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
  order by pos.valor_total desc
$$;

revoke execute on function relatorio_estoque_valorizado(bigint, text[], text[], bigint[], text) from public;
revoke execute on function relatorio_estoque_valorizado(bigint, text[], text[], bigint[], text) from anon;
grant  execute on function relatorio_estoque_valorizado(bigint, text[], text[], bigint[], text) to authenticated, service_role;
