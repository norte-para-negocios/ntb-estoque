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
-- OP revertida não está concluída e não entra. Uma linha por papel × dia × produto.
-- security invoker: vale a RLS de quem chama. Teste: scripts/testes-sql/211_relatorio_ops_periodo.sql.

drop function if exists public.relatorio_ops_periodo(bigint, date, date);
create or replace function public.relatorio_ops_periodo(p_loja_id bigint, p_ini date, p_fim date, p_fonte text default 'ops')
returns table (papel text, dia date, n_cod_prod bigint, ops integer, qtde numeric, custo numeric)
language sql stable security invoker set search_path = public as $$
  with modo as (select coalesce((select l.modo_estoque from lojas l where l.id = p_loja_id), 'omie') as m),
  op as (
    select o.id, o.dt_conclusao_real as dia, o.identificacao_n_cod_produto as prod, coalesce(o.identificacao_n_qtde, 0) as q,
           o.custo_total, o.producao_ref, o.full_object
    from ordens_producao o
    where coalesce(p_fonte, 'ops') <> 'kardex'
      and o.loja_id = p_loja_id and o.concluida and o.dt_conclusao_real between p_ini and p_fim
      and coalesce(o.identificacao_n_cod_produto, 0) <> 0
  ),
  u as (
    select 'produzido'::text as papel, op.dia, op.prod, op.id as op_id, op.q,
           case when (select m from modo) = 'proprio' then op.custo_total end as custo
    from op
    union all
    select 'consumido', op.dia, nullif(i.item->>'nIdProdutoMalha', '')::bigint, op.id,
           abs(coalesce(nullif(i.item->>'nQtde', '')::numeric, 0)), null::numeric
    from op
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(op.full_object->'itensDetalhes') = 'array' then op.full_object->'itensDetalhes' else '[]'::jsonb end
    ) as i(item)
    where (select m from modo) <> 'proprio' and coalesce(nullif(i.item->>'nIdProdutoMalha', '')::bigint, 0) <> 0
    union all
    select 'consumido', op.dia, it.codigo_insumo, op.id, abs(it.quantidade), abs(it.quantidade) * coalesce(it.custo_unitario, 0)
    from op
    join ordens_producao_proprio pp on pp.loja_id = p_loja_id and pp.ref = op.producao_ref
    join ordens_producao_proprio_itens it on it.ordem_id = pp.id
    where (select m from modo) = 'proprio'
    union all
    select case when k.cod_origem = 'OPE' then 'produzido' else 'consumido' end, k.data_mov, k.n_cod_prod, k.id,
           abs(k.quantidade), abs(k.quantidade) * k.valor_unit
    from kardex_omie k
    where p_fonte = 'kardex' and (select m from modo) <> 'proprio'
      and k.loja_id = p_loja_id and k.data_mov between p_ini and p_fim and not k.cancelado and k.cod_origem in ('OPE', 'OPS')
  )
  select u.papel, u.dia, u.prod, count(distinct u.op_id)::int, round(sum(u.q), 6), round(sum(u.custo), 2)
  from u
  group by u.papel, u.dia, u.prod
  order by u.papel, u.dia, u.prod
$$;

revoke all on function public.relatorio_ops_periodo(bigint, date, date, text) from public, anon;
grant execute on function public.relatorio_ops_periodo(bigint, date, date, text) to authenticated;
