-- 211: Produção por produto e matéria-prima consumida no período (Fase D item 6, matriz N17/N18/N20). Só leitura.
--
-- Os relatórios do Omie "Ordens de Produção — por Produto / por Matéria-prima / Concluídas" não abriram na captura
-- (timeout); a regra é a mesma que a Movimentação já usa (movimentacoes_loja, migration 170): OP concluída com
-- dt_conclusao_real no período.
--   loja Omie   : produzido = identificacao_n_qtde; consumido = cada item da ficha gravada na OP (full_object.itensDetalhes,
--                 nQtde = total da OP); sem custo (o Omie não grava o custo na OP).
--   loja própria: produzido = identificacao_n_qtde e custo_total; consumido = o que a produção realmente baixou
--                 (ordens_producao_proprio da conclusão atual, ref = producao_ref) com o custo de cada insumo.
--   p_fonte = 'kardex' (loja Omie com o espelho do kardex cobrindo o período, escolha feita no app): o que o Omie
--                 realmente lançou no estoque, OPE = produzido e OPS = consumido, custo = quantidade × valor do movimento;
--                 `ops` passa a contar movimentos. Motivo (loja 5, 12/09–13/10/2026): o kardex tem 15.449 entradas de
--                 produção e ordens_producao só 7.044 OPs concluídas (6.855 delas casam com uma entrada do kardex por
--                 produto e quantidade); as OPs que faltam no espelho de OPs estão no kardex.
-- OP revertida não está concluída e não entra. p_produtos (opcional) limita aos produtos do filtro da tela.
--
-- Devolve um jsonb só, já agregado (revisão de 19/10: a versão por papel × dia × produto dava 56 mil linhas num ano da
-- loja 5 e 57 chamadas paginadas, ~90 s):
--   { "produtos": [{papel, n_cod_prod, ops, qtde, custo, dias}], "dias": [{dia, ops, qtde}] }
-- custo do produto = nulo quando alguma linha não tem custo (nunca um total pela metade); "dias" = só a produção.
-- Cada linha de `u` é uma OP × produto (produzido) ou OP × insumo (consumido; insumo repetido na ficha da OP vira uma
-- linha só), então "ops" = count(*), sem count(distinct) nem ordenação; o full_object só é lido no consumo do Omie.
-- security invoker: vale a RLS de quem chama. Teste: scripts/testes-sql/211_relatorio_ops_periodo.sql.

drop function if exists public.relatorio_ops_periodo(bigint, date, date);
drop function if exists public.relatorio_ops_periodo(bigint, date, date, text);
create or replace function public.relatorio_ops_periodo(p_loja_id bigint, p_ini date, p_fim date, p_fonte text default 'ops', p_produtos bigint[] default null)
returns jsonb
language sql stable security invoker set search_path = public set work_mem = '32MB' as $$
  with modo as (select coalesce((select l.modo_estoque from lojas l where l.id = p_loja_id), 'omie') as m),
  u as (
    select 1::smallint as papel, o.dt_conclusao_real as dia, o.identificacao_n_cod_produto as prod,
           coalesce(o.identificacao_n_qtde, 0) as q,
           case when (select m from modo) = 'proprio' then o.custo_total end as custo
    from ordens_producao o
    where coalesce(p_fonte, 'ops') <> 'kardex'
      and o.loja_id = p_loja_id and o.concluida and o.dt_conclusao_real between p_ini and p_fim
      and coalesce(o.identificacao_n_cod_produto, 0) <> 0
    union all
    select 2::smallint, o.dt_conclusao_real, i.prod, i.q, null::numeric
    from ordens_producao o
    cross join lateral (
      select nullif(e."nIdProdutoMalha", '')::bigint as prod, sum(abs(coalesce(nullif(e."nQtde", '')::numeric, 0))) as q
      from jsonb_to_recordset(case when jsonb_typeof(o.full_object->'itensDetalhes') = 'array' then o.full_object->'itensDetalhes' else '[]'::jsonb end)
           as e("nIdProdutoMalha" text, "nQtde" text)
      where coalesce(nullif(e."nIdProdutoMalha", '')::bigint, 0) <> 0
      group by 1
    ) i
    where coalesce(p_fonte, 'ops') <> 'kardex' and (select m from modo) <> 'proprio'
      and o.loja_id = p_loja_id and o.concluida and o.dt_conclusao_real between p_ini and p_fim
      and coalesce(o.identificacao_n_cod_produto, 0) <> 0
    union all
    select 2::smallint, o.dt_conclusao_real, it.codigo_insumo, sum(abs(it.quantidade)), sum(abs(it.quantidade) * coalesce(it.custo_unitario, 0))
    from ordens_producao o
    join ordens_producao_proprio pp on pp.loja_id = p_loja_id and pp.ref = o.producao_ref
    join ordens_producao_proprio_itens it on it.ordem_id = pp.id
    where coalesce(p_fonte, 'ops') <> 'kardex' and (select m from modo) = 'proprio'
      and o.loja_id = p_loja_id and o.concluida and o.dt_conclusao_real between p_ini and p_fim
      and coalesce(o.identificacao_n_cod_produto, 0) <> 0
    group by o.id, o.dt_conclusao_real, it.codigo_insumo
    union all
    select case when k.cod_origem = 'OPE' then 1::smallint else 2::smallint end, k.data_mov, k.n_cod_prod,
           abs(k.quantidade), abs(k.quantidade) * k.valor_unit
    from kardex_omie k
    where p_fonte = 'kardex' and (select m from modo) <> 'proprio'
      and k.loja_id = p_loja_id and k.data_mov between p_ini and p_fim and not k.cancelado and k.cod_origem in ('OPE', 'OPS')
  ),
  pordia as materialized (
    select papel, prod, dia, count(*) as ops, sum(q) as q, sum(custo) as custo, bool_and(custo is not null) as tem_custo
    from u where p_produtos is null or u.prod = any (p_produtos)
    group by papel, prod, dia
  ),
  prods as (
    select papel, prod, sum(ops)::int as ops, round(sum(q), 6) as qtde,
           case when bool_and(tem_custo) then round(sum(custo), 2) end as custo, count(*)::int as dias
    from pordia group by papel, prod
  ),
  dias as (
    select dia, sum(ops)::int as ops, round(sum(q), 6) as qtde from pordia where papel = 1 group by dia
  )
  select jsonb_build_object(
    'produtos', coalesce((select jsonb_agg(jsonb_build_object('papel', case papel when 1 then 'produzido' else 'consumido' end, 'n_cod_prod', prod, 'ops', ops, 'qtde', qtde, 'custo', custo, 'dias', dias)
                                           order by papel, prod) from prods), '[]'::jsonb),
    'dias', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'ops', ops, 'qtde', qtde) order by dia) from dias), '[]'::jsonb)
  )
$$;

revoke all on function public.relatorio_ops_periodo(bigint, date, date, text, bigint[]) from public, anon;
grant execute on function public.relatorio_ops_periodo(bigint, date, date, text, bigint[]) to authenticated;
