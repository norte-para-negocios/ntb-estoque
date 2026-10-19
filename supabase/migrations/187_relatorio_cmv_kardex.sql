-- 187: CMV/CPV pelo kardex do Omie (Fase D, matriz N9). Só leitura, nenhuma tabela nova.
--
-- O relatório CMV/CPV do Omie (COM_CMV_CPV) é, por produto, EI + C + P − EF (estoque inicial + compras + entrada da
-- produção − estoque final, tudo ao CMC). Aqui sai do espelho do kardex (kardex_omie), com o valor de cada movimento
-- (quantidade × valor_unit: saída = CMC da hora, E12; compra = custo da nota), e também a abertura do que saiu:
--   vendas      = saídas do PDV e de NF de venda (PDV, VEN) menos devoluções e cancelamentos de venda (DVP, CVP);
--   consumo_op  = consumo das ordens de produção (OPS) = CPV;
--   producao    = entrada das ordens de produção (OPE);
--   compras     = COM, IMP, CIM e devoluções ao fornecedor (DCP, CDC), com o sinal do movimento;
--   o resto (ajustes, inventário, outras notas) vai para outras_entradas / outras_saidas.
-- EI e EF por produto × local pela cadeia de saldo do dia (saldo_em_data da 173); produto × local sem movimento antes
-- do início: EI = EF − fluxo do período. Só vale dentro do histórico completo do kardex (a tela confere a cobertura
-- em espelho_sync_estado antes de chamar).
-- quebra = por produto, soma em todos os locais de |saldo inicial + Σ quantidade do período − saldo final| (em
-- quantidade) onde existe saldo inicial: o saldo do Omie "pulou" sem movimento no espelho (lacuna do espelho, ex.
-- loja 5, azeitona 80203, 4,18 → 3.001,18 em 12/10/2026). A tela tira esses produtos do total da fórmula EI + C + P − EF
-- e lista quais são; vendas/consumo vêm do fluxo e não dependem disso.
-- Depende da 173 (saldo_em_data na ordem do Omie). security invoker: vale a RLS de quem chama (kardex_omie, 161).
-- Teste: scripts/testes-sql/187_relatorio_cmv_kardex.sql (cópia local, nunca em produção).

drop function if exists public.relatorio_cmv_kardex(bigint, date, date);
create function public.relatorio_cmv_kardex(p_loja_id bigint, p_ini date, p_fim date)
returns table (
  n_cod_prod bigint, ei numeric, compras numeric, producao numeric, outras_entradas numeric,
  vendas numeric, qtd_vendida numeric, consumo_op numeric, outras_saidas numeric, ef numeric, sem_custo integer, quebra numeric
)
language sql stable security invoker set search_path = public as $$
  with mov as (
    select k.n_cod_prod, k.codigo_local_estoque, k.cod_origem as o, k.quantidade as q,
           k.quantidade * coalesce(k.valor_unit, 0) as v, k.valor_unit is null as sem
    from kardex_omie k
    where k.loja_id = p_loja_id and k.data_mov between p_ini and p_fim and not k.cancelado
  ), fluxo as (
    select n_cod_prod, codigo_local_estoque,
           sum(v) as liquido, sum(q) as liquido_q,
           coalesce(sum(v) filter (where o in ('COM', 'IMP', 'CIM', 'DCP', 'CDC')), 0) as compras,
           coalesce(sum(v) filter (where o = 'OPE'), 0) as producao,
           coalesce(-sum(v) filter (where o in ('PDV', 'VEN', 'DVP', 'CVP')), 0) as vendas,
           coalesce(-sum(q) filter (where o in ('PDV', 'VEN', 'DVP', 'CVP')), 0) as qtd_vendida,
           coalesce(-sum(v) filter (where o = 'OPS'), 0) as consumo_op,
           coalesce(sum(v) filter (where o not in ('COM', 'IMP', 'CIM', 'DCP', 'CDC', 'OPE', 'PDV', 'VEN', 'DVP', 'CVP', 'OPS') and q > 0), 0) as outras_entradas,
           coalesce(-sum(v) filter (where o not in ('COM', 'IMP', 'CIM', 'DCP', 'CDC', 'OPE', 'PDV', 'VEN', 'DVP', 'CVP', 'OPS') and q < 0), 0) as outras_saidas,
           count(*) filter (where sem)::int as sem_custo
    from mov
    group by n_cod_prod, codigo_local_estoque
  ), fim as (
    select s.n_cod_prod, s.codigo_local_estoque, s.saldo, s.saldo * coalesce(s.cmc, 0) as valor from saldo_em_data(p_loja_id, p_fim) s
  ), ini as (
    select s.n_cod_prod, s.codigo_local_estoque, s.saldo, s.saldo * coalesce(s.cmc, 0) as valor from saldo_em_data(p_loja_id, p_ini - 1) s
  ), pl as (
    select coalesce(f.n_cod_prod, x.n_cod_prod) as n_cod_prod,
           coalesce(f.valor, 0) as ef,
           coalesce(i.valor, coalesce(f.valor, 0) - coalesce(x.liquido, 0)) as ei,
           case when i.saldo is not null then abs(i.saldo + coalesce(x.liquido_q, 0) - coalesce(f.saldo, 0)) else 0 end as quebra,
           x.liquido, x.compras, x.producao, x.vendas, x.qtd_vendida, x.consumo_op, x.outras_entradas, x.outras_saidas, x.sem_custo
    from fim f
    full join fluxo x on x.n_cod_prod = f.n_cod_prod and x.codigo_local_estoque = f.codigo_local_estoque
    left join ini i on i.n_cod_prod = coalesce(f.n_cod_prod, x.n_cod_prod) and i.codigo_local_estoque = coalesce(f.codigo_local_estoque, x.codigo_local_estoque)
  )
  select pl.n_cod_prod,
         round(sum(pl.ei), 2), round(sum(coalesce(pl.compras, 0)), 2), round(sum(coalesce(pl.producao, 0)), 2),
         round(sum(coalesce(pl.outras_entradas, 0)), 2), round(sum(coalesce(pl.vendas, 0)), 2),
         round(sum(coalesce(pl.qtd_vendida, 0)), 6), round(sum(coalesce(pl.consumo_op, 0)), 2),
         round(sum(coalesce(pl.outras_saidas, 0)), 2), round(sum(pl.ef), 2), sum(coalesce(pl.sem_custo, 0))::int,
         round(sum(case when pl.quebra > 0.01 then pl.quebra else 0 end), 6)
  from pl
  group by pl.n_cod_prod
  having bool_or(pl.liquido is not null) or round(sum(pl.ei), 2) <> 0 or round(sum(pl.ef), 2) <> 0
  order by pl.n_cod_prod
$$;
revoke all on function public.relatorio_cmv_kardex(bigint, date, date) from public, anon;
grant execute on function public.relatorio_cmv_kardex(bigint, date, date) to authenticated, service_role;
