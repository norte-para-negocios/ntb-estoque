-- 282: Paridade numérica com o Omie (bug B4 de omie-rea/gaps/paridade-numerica-2026-10-20.md) — CMV/CPV: estoque
-- inicial e final de TODOS os produtos, não só dos que têm linha no kardex espelhado.
--
-- O relatório CMV/CPV do Omie (COM_CMV_CPV) traz EI e EF de todo produto com estoque (posição ao CMC, E1/E2/E4 de
-- omie-rea/regras/estoque-saldo-e-custo.md: por produto × local, negativos entram). A 187 tirava EI/EF de
-- saldo_em_data (173), que só conhece produto × local com movimento no kardex espelhado até a data. Na loja 5, em
-- 17/10/2026, 711 produtos com estoque no Omie (EI 646.125,72) não apareciam.
--
-- saldo_em_data_completo(loja, data) = saldo e CMC de cada produto × local na data, de três fontes:
--   kardex          — o de sempre (saldo_em_data, cadeia de saldo do dia, 173);
--   antes_do_kardex — produto × local cujo 1º movimento no espelho é DEPOIS da data: o saldo antes desse movimento
--                     (começo da cadeia do 1º dia, E13) e o CMC de antes (saída não muda o CMC, E12; entrada desfaz a
--                     média móvel E9: C0 = (S1·C1 − q·vu) ÷ S0, só com S0 > 0, senão o CMC depois);
--   foto            — produto × local SEM nenhuma linha no kardex: a foto mais recente de posicao_estoques pela
--                     posicao_valorizada (abaixo; custo suspeito trocado pela referência, igual à Posição). Sem movimento
--                     no espelho o saldo não mudou; a mesma foto vale para EI e EF (EI = EF). Limite: se o produto mexeu
--                     depois do fim do espelho, a foto já tem esse movimento (o espelho da loja 5 parou em 16/10, bug 1).
--
-- posicao_valorizada(loja, data = foto mais recente) — UMA regra de valor da foto do Omie para Posição de estoque
-- (tela e Excel), Estoque Valorizado (283) e a fonte "foto" acima. Valor por produto × local = saldo × CMC, negativos
-- entram, sentinela 0 fora. CMC "suspeito" (dado errado no Omie: loja 3 em 20/10 tinha Moqueca de Camarão 600 g
-- −29 × CMC 3.649.182 e o total ia a −R$ 140 milhões) quando:
--   CMC ≥ 1e7 (trava antiga); ou CMC > 10 × a referência de custo do produto, que é (1) o CMC ponderado dos locais do
--   produto com saldo positivo ou, sem eles, (2) o custo unitário da última entrada por nota (valor de estoque N3 ÷
--   quantidade recebida) — regra decidida pelo dono em 20/10; ou, sem referência de custo, (3) CMC > 10 × o preço de
--   venda do cadastro (ACRÉSCIMO aprovado pelo dono em 20/10: prato produzido não tem local positivo nem nota de entrada — sem isso a loja 3 ficava em
--   −R$ 7,4 milhões com Moqueca −164 × 41.040, preço 184,90); ou, sem nada disso, linha negativa com CMC > 100 mil.
-- Linha suspeita vale saldo × referência de custo (0 sem referência de custo); `valor_omie` guarda o valor cru, e a
-- tela mostra "N linhas com custo médio suspeito no Omie (R$ X ajustados)" com a lista (total + ajuste = Omie).
--
-- relatorio_cmv_kardex (mesma assinatura e colunas, CREATE OR REPLACE): EI/EF pela função nova. O CMV por produto NÃO
-- muda: para produto × local COM movimento no período o EI continua o da 187 (kardex até a véspera ou, sem ele,
-- EF − fluxo do período) e a quebra só é medida com saldo inicial do kardex, como antes; as fontes novas só entram para
-- produto × local SEM movimento no período (aí EI = EF e a fórmula EI + C + P − EF dá 0, como no Omie).
--
-- Prova (produção, só leitura, 20/10/2026, corpo novo rodado como consulta): ver AGENTS.md "Paridade numérica 20/10".
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 282_cmv_estoque_todos_produtos.sql
-- Reverter: reaplicar 187_relatorio_cmv_kardex.sql (relatorio_cmv_kardex) e drop function saldo_em_data_completo e
-- posicao_valorizada (depois de reverter a 283, que a usa).
-- Teste: scripts/testes-sql/282_cmv_estoque_todos_produtos.sql (banco local com o kardex real da loja 5).

begin;

create or replace function public.posicao_valorizada(p_loja_id bigint, p_data date default null)
returns table (
  n_cod_prod bigint, codigo_local_estoque bigint, data_posicao date, n_saldo numeric, n_cmc numeric, reservado numeric,
  cmc_usado numeric, valor numeric, suspeito boolean, referencia numeric, fonte_referencia text, valor_omie numeric
)
language sql stable security invoker set search_path = public as $$
  with foto as (
    select coalesce(p_data, (select max(pe.data_posicao) from posicao_estoques pe where pe.loja_id = p_loja_id and pe.codigo_local_estoque <> 0)) as d
  ), l as (
    select pe.n_cod_prod, pe.codigo_local_estoque, pe.data_posicao, coalesce(pe.n_saldo, 0) as n_saldo, coalesce(pe.n_cmc, 0) as n_cmc, pe.reservado
    from posicao_estoques pe
    join foto f on pe.data_posicao = f.d
    where pe.loja_id = p_loja_id and pe.codigo_local_estoque <> 0
  ), ref_locais as (  -- referência 1: CMC ponderado dos locais do produto com saldo positivo
    select l.n_cod_prod, sum(l.n_saldo * l.n_cmc) / sum(l.n_saldo) as ref
    from l
    where l.n_saldo > 0 and l.n_cmc > 0 and l.n_cmc < 10000000
    group by l.n_cod_prod
  ), sem_ref as (
    select distinct l.n_cod_prod from l
    where l.n_saldo <> 0 and l.n_cmc > 0 and not exists (select 1 from ref_locais r where r.n_cod_prod = l.n_cod_prod)
  ), ref_entrada as (  -- referência 2: custo unitário da última entrada (valor de estoque N3 ÷ quantidade recebida)
    select s.n_cod_prod, e.c as ref
    from sem_ref s
    cross join lateral (
      select custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit)
             / nullif(coalesce(nullif(nullif(i.full_object->'itensAjustes'->>'nQtdeRecebida', '')::numeric, 0), i.n_qtde_nfe), 0) as c
      from nota_fiscal_items i
      join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
      where i.loja_id = p_loja_id and i.n_id_produto = s.n_cod_prod
        and nf.deleted_at is null and nf.c_etapa = '60' and item_movimenta_estoque(i.full_object)
      order by nf.d_emissao_nfe desc, i.id desc
      limit 1
    ) e
    where e.c > 0
  ), ref as (
    select r.n_cod_prod, r.ref, 'locais'::text as f from ref_locais r
    union all
    select r.n_cod_prod, r.ref, 'entrada'::text from ref_entrada r
  ), av as (
    select l.*, r.ref, r.f, pr.valor_unitario as preco,
           case when l.n_cmc <= 0 or l.n_saldo = 0 then false
                when l.n_cmc >= 10000000 then true                          -- trava antiga: nunca vale como custo
                when r.ref is not null then l.n_cmc > 10 * r.ref            -- regra do dono: mais de 10× a referência de custo
                when pr.valor_unitario > 0 then l.n_cmc > 10 * pr.valor_unitario  -- sem custo de referência: 10× o preço de venda
                else l.n_saldo < 0 and l.n_cmc > 100000                     -- sem nada: linha negativa com CMC > 100 mil
           end as susp
    from l
    left join ref r on r.n_cod_prod = l.n_cod_prod
    left join produtos pr on pr.loja_id = p_loja_id and pr.codigo_produto = l.n_cod_prod
  )
  select av.n_cod_prod, av.codigo_local_estoque, av.data_posicao, av.n_saldo, av.n_cmc, av.reservado,
         case when av.susp then coalesce(round(av.ref, 6), 0) when av.n_cmc > 0 then av.n_cmc else 0 end as cmc_usado,
         round(av.n_saldo * case when av.susp then coalesce(round(av.ref, 6), 0) when av.n_cmc > 0 then av.n_cmc else 0 end, 2) as valor,
         av.susp as suspeito, round(av.ref, 6) as referencia, av.f as fonte_referencia,
         round(av.n_saldo * av.n_cmc, 2) as valor_omie
  from av
$$;

revoke all on function public.posicao_valorizada(bigint, date) from public, anon;
grant execute on function public.posicao_valorizada(bigint, date) to authenticated, service_role;

create or replace function public.saldo_em_data_completo(p_loja_id bigint, p_data date)
returns table (n_cod_prod bigint, codigo_local_estoque bigint, saldo numeric, cmc numeric, fonte text)
language sql stable security invoker set search_path = public as $$
  with k as (
    select s.n_cod_prod, s.codigo_local_estoque, s.saldo, s.cmc from saldo_em_data(p_loja_id, p_data) s
  ), pares as (  -- produto × local com alguma linha no kardex espelhado (qualquer data)
    select x.n_cod_prod, x.codigo_local_estoque, min(x.data_mov) as d0
    from kardex_omie x
    where x.loja_id = p_loja_id and not x.cancelado
    group by x.n_cod_prod, x.codigo_local_estoque
  ), dia0 as (  -- só os pares cujo 1º movimento é depois da data: as linhas desse 1º dia
    select x.n_cod_prod, x.codigo_local_estoque, x.id_mov, x.quantidade, x.valor_unit, x.saldo_apos, x.cmc_apos,
           round(x.saldo_apos - x.quantidade, 6) as antes, round(x.saldo_apos, 6) as depois
    from pares p
    join kardex_omie x on x.loja_id = p_loja_id and not x.cancelado
      and x.n_cod_prod = p.n_cod_prod and x.codigo_local_estoque = p.codigo_local_estoque and x.data_mov = p.d0
    where p.d0 > p_data
  ), abre as (  -- começo da cadeia do dia (E13): o "antes" que não é o "depois" de outra linha; empate = menor id_mov
    select distinct on (a.n_cod_prod, a.codigo_local_estoque) a.*
    from dia0 a
    order by a.n_cod_prod, a.codigo_local_estoque,
             exists (select 1 from dia0 b where b.n_cod_prod = a.n_cod_prod and b.codigo_local_estoque = a.codigo_local_estoque
                                           and b.id_mov <> a.id_mov and b.depois = a.antes),
             a.id_mov
  ), antes_do_kardex as (
    select a.n_cod_prod, a.codigo_local_estoque, a.antes as saldo,
           case when a.quantidade < 0 or a.antes <= 0 then a.cmc_apos
                else coalesce(nullif(greatest(0, round((a.saldo_apos * coalesce(a.cmc_apos, 0) - a.quantidade * coalesce(a.valor_unit, 0)) / a.antes, 6)), 0), a.cmc_apos)
           end as cmc
    from abre a
  ), foto as (  -- mesma regra de valor da Posição/Estoque Valorizado (custo suspeito trocado pela referência)
    select v.n_cod_prod, v.codigo_local_estoque, v.n_saldo as saldo, v.cmc_usado as cmc
    from posicao_valorizada(p_loja_id) v
    where not exists (select 1 from pares p where p.n_cod_prod = v.n_cod_prod and p.codigo_local_estoque = v.codigo_local_estoque)
  )
  select k.n_cod_prod, k.codigo_local_estoque, k.saldo, k.cmc, 'kardex'::text as fonte from k
  union all
  select a.n_cod_prod, a.codigo_local_estoque, a.saldo, a.cmc, 'antes_do_kardex'::text from antes_do_kardex a
  union all
  select f.n_cod_prod, f.codigo_local_estoque, f.saldo, f.cmc, 'foto'::text from foto f
$$;

revoke all on function public.saldo_em_data_completo(bigint, date) from public, anon;
grant execute on function public.saldo_em_data_completo(bigint, date) to authenticated, service_role;

create or replace function public.relatorio_cmv_kardex(p_loja_id bigint, p_ini date, p_fim date)
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
    select s.n_cod_prod, s.codigo_local_estoque, s.saldo, s.saldo * coalesce(s.cmc, 0) as valor, s.fonte from saldo_em_data_completo(p_loja_id, p_fim) s
  ), ini as (
    select s.n_cod_prod, s.codigo_local_estoque, s.saldo, s.saldo * coalesce(s.cmc, 0) as valor, s.fonte from saldo_em_data_completo(p_loja_id, p_ini - 1) s
  ), pl as (
    select coalesce(f.n_cod_prod, x.n_cod_prod) as n_cod_prod,
           coalesce(f.valor, 0) as ef,
           -- com movimento no período: igual à 187 (kardex até a véspera; sem ele, EF − fluxo). Sem movimento: fonte nova.
           case when x.liquido is not null and i.fonte is distinct from 'kardex' then coalesce(f.valor, 0) - x.liquido
                else coalesce(i.valor, coalesce(f.valor, 0) - coalesce(x.liquido, 0)) end as ei,
           case when i.fonte = 'kardex' then abs(i.saldo + coalesce(x.liquido_q, 0) - coalesce(f.saldo, 0)) else 0 end as quebra,
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

commit;

notify pgrst, 'reload schema';
