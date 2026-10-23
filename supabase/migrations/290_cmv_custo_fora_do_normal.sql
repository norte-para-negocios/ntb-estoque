-- 290: CMV/CPV e Movimentação "valor do movimento" com custo fora do normal do Omie trocado pelo custo normal do
-- produto, e avisado. Só leitura (funções), nenhuma tabela nova. Depende da 282 (posicao_valorizada,
-- saldo_em_data_completo) e da 188. A 295 usa teto_custo_unidade daqui: aplicar a 290 antes da 295.
--
-- Por quê (produção, loja 5, 01–23/10/2026, só leitura): o CMV da tela deu R$ 4.581.956.400,13 para um faturamento de
-- R$ 592.802,60. O relatório usa o valor de cada movimento do kardex do Omie, e o Omie gravou custos absurdos:
--   - Suco de Morango Jarra 730 ML: com o saldo negativo (−17 a −32) cada entrada de OP a R$ 8,18 faz a média móvel
--     do Omie explodir; as 74 saídas do PDV saíram a R$ 106 a 194 MILHÕES cada (R$ 4.521.358.032,05), contra R$ 8,21
--     de custo normal (mediana do produto em 120 dias);
--   - Camarão na Tapioca: saídas a R$ 680 mil–1,68 mi (normal 9,89); Moqueca Siri Catado: 190.280 (normal 72,72);
--   - bolinhos, Abará, Camarão/Lula a Dorê, Frango Filé: a partir de 14–15/10 a própria OP entra a R$ 357–729 (normal
--     11–37), porque um insumo do prato ficou com custo errado; as saídas do PDV herdam esse custo;
--   - insumos com unidade errada na nota: MONIN 700 ML a R$ 49,75 por ml (o preço da garrafa por ml), PICLES a R$ 39/g,
--     MOLHO TÁRTARO R$ 23.146/kg; contaminam o consumo das OPs (CPV) e o custo das sodas artesanais (R$ 2.488/un.).
--
-- Regra (custo_referencia_produto, uma por loja e data):
--   teto (o que não existe num restaurante): a escala da unidade, a MESMA da Posição de estoque (295), em
--   teto_custo_unidade(unidade, tipo): R$ 5 por g/ml (G, GR, GRS, GRAMA, GRAMAS, ML; ML de tipo 08/99 é metro e fica de
--   fora) e R$ 2.000 por kg/l (KG, KGS, L, LT, LTS, LITRO); e, para produto vendido (tipo 00/04 ou com saída de PDV no
--   kardex nos 120 dias) com preço de venda plausível (≥ R$ 1; cortesia a R$ 0,01 não vale), 2 × o preço.
--   referência do produto = mediana do valor unitário dos movimentos do kardex do produto nos 120 dias até a data que
--   estão abaixo do teto (cada movimento conta uma vez: um erro de alguns dias não muda a mediana); sem nenhum, a
--   referência da foto (posicao_valorizada: CMC dos locais positivos ou última nota de entrada), se abaixo do teto;
--   senão o produto fica sem custo confiável.
--   limite = menor entre 10 × a referência (mesma regra de 10× da Posição de estoque, 282) e o teto.
-- Movimento com valor unitário acima do limite (exceto compra e devolução de compra: dinheiro pago pela nota) passa a
-- valer quantidade × referência (0 sem referência confiável); o valor cru do Omie continua na linha (_omie) e a contagem
-- de movimentos trocados vai junto, para a tela listar. O CMC do estoque inicial/final segue a mesma regra, menos o
-- saldo que vem da foto (posicao_valorizada já deu o valor dele pela regra da Posição: não é trocado de novo).
-- Limite conhecido: a mediana segura erro de alguns dias; se o custo ficou errado em mais da metade dos movimentos dos
-- 120 dias, a mediana é o custo errado e só o teto da unidade/preço pega.
--
-- Prova (produção, só leitura, 23/10, corpo como consulta): loja 5, 01–23/10, saídas do PDV 4.581.956.613,59 →
-- 173.388,08 (29,2 % do faturamento; 244 de 11.691 movimentos trocados), consumo das OPs 230.571,86 → 162.205,98
-- (140 movimentos), produção 234.511,28 → 164.195,15 (140).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 290_cmv_custo_fora_do_normal.sql
-- Reverter: reaplicar 282 (relatorio_cmv_kardex) e 188 (relatorio_movimentacao_valor_mov) — os dois com DROP antes,
-- porque esta muda as colunas — e drop function custo_referencia_produto, relatorio_cmv_kardex_json,
-- relatorio_movimentacao_valor_mov_json e teto_custo_unidade (depois de reverter a 295, que a usa).
-- Teste: scripts/testes-sql/290_cmv_custo_fora_do_normal.sql (banco local com o kardex real da loja 5).

begin;

-- Escala da unidade: teto do custo por unidade que não existe num restaurante. ÚNICA regra, usada aqui e na 295.
create or replace function public.teto_custo_unidade(p_unidade text, p_tipo_item text)
returns numeric
language sql immutable parallel safe set search_path = public as $$
  select case when upper(btrim(coalesce(p_unidade, ''))) in ('G', 'GR', 'GRS', 'GRAMA', 'GRAMAS')
                or (upper(btrim(coalesce(p_unidade, ''))) = 'ML' and coalesce(p_tipo_item, '') not in ('08', '99')) then 5::numeric
              when upper(btrim(coalesce(p_unidade, ''))) in ('KG', 'KGS', 'L', 'LT', 'LTS', 'LITRO') then 2000::numeric
         end
$$;
grant execute on function public.teto_custo_unidade(text, text) to authenticated, service_role;

drop function if exists public.custo_referencia_produto(bigint, date);
create or replace function public.custo_referencia_produto(p_loja_id bigint, p_ate date, p_produtos bigint[] default null)
returns table (n_cod_prod bigint, referencia numeric, limite numeric, teto numeric, fonte text)
language sql stable security invoker set search_path = public as $$
  with janela as (
    select x.n_cod_prod, x.cod_origem, x.valor_unit
    from kardex_omie x
    where x.loja_id = p_loja_id and not x.cancelado and x.valor_unit > 0 and x.data_mov between p_ate - 120 and p_ate
      and (p_produtos is null or x.n_cod_prod = any(p_produtos))
  ), vendidos as (
    select distinct j.n_cod_prod from janela j where j.cod_origem in ('PDV', 'VEN')
  ), tetos as (
    select pr.codigo_produto as n_cod_prod,
           case when (pr.tipo_item in ('00', '04') or exists (select 1 from vendidos v where v.n_cod_prod = pr.codigo_produto))
                     and pr.valor_unitario >= 1 then 2 * pr.valor_unitario end as teto_preco,
           teto_custo_unidade(pr.unidade, pr.tipo_item) as teto_unidade
    from produtos pr
    where pr.loja_id = p_loja_id and (p_produtos is null or pr.codigo_produto = any(p_produtos))
  ), t as (
    select t0.n_cod_prod, case when t0.teto_preco is null then t0.teto_unidade when t0.teto_unidade is null then t0.teto_preco
                               else least(t0.teto_preco, t0.teto_unidade) end as teto
    from tetos t0
  ), k as (  -- mediana só dos movimentos dentro do plausível (abaixo do teto)
    select j.n_cod_prod, percentile_cont(0.5) within group (order by j.valor_unit)::numeric as med
    from janela j
    left join t on t.n_cod_prod = j.n_cod_prod
    where t.teto is null or j.valor_unit <= t.teto
    group by j.n_cod_prod
  ), foto as (
    select v.n_cod_prod, max(v.referencia) as ref
    from posicao_valorizada(p_loja_id) v
    where v.referencia > 0 and (p_produtos is null or v.n_cod_prod = any(p_produtos))
    group by v.n_cod_prod
  ), r as (
    select coalesce(t.n_cod_prod, k.n_cod_prod, f.n_cod_prod) as n_cod_prod, t.teto,
           case when k.med > 0 then k.med
                when f.ref > 0 and (t.teto is null or f.ref <= t.teto) then f.ref end as referencia,
           case when k.med > 0 then 'kardex'
                when f.ref > 0 and (t.teto is null or f.ref <= t.teto) then 'foto' end as fonte
    from t
    full join k on k.n_cod_prod = t.n_cod_prod
    full join foto f on f.n_cod_prod = coalesce(t.n_cod_prod, k.n_cod_prod)
  )
  select r.n_cod_prod, round(r.referencia, 6) as referencia,
         case when r.referencia is null then r.teto when r.teto is null then 10 * r.referencia else least(10 * r.referencia, r.teto) end as limite,
         r.teto, r.fonte
  from r
  where r.n_cod_prod is not null and (r.referencia is not null or r.teto is not null)
  order by r.n_cod_prod  -- ordem total: a tela pagina pelo PostgREST
$$;
revoke all on function public.custo_referencia_produto(bigint, date, bigint[]) from public, anon;
grant execute on function public.custo_referencia_produto(bigint, date, bigint[]) to authenticated, service_role;

drop function if exists public.relatorio_cmv_kardex_json(bigint, date, date);
drop function if exists public.relatorio_cmv_kardex(bigint, date, date);
create function public.relatorio_cmv_kardex(p_loja_id bigint, p_ini date, p_fim date)
returns table (
  n_cod_prod bigint, ei numeric, compras numeric, producao numeric, outras_entradas numeric,
  vendas numeric, qtd_vendida numeric, consumo_op numeric, outras_saidas numeric, ef numeric, sem_custo integer, quebra numeric,
  vendas_omie numeric, consumo_op_omie numeric, producao_omie numeric, ei_omie numeric, ef_omie numeric,
  ajustados integer, ajustados_estoque integer, sem_referencia integer, custo_referencia numeric
)
language sql stable security invoker set search_path = public as $$
  with ref as (
    select * from custo_referencia_produto(p_loja_id, p_fim)
  ), mov as (
    select k.n_cod_prod, k.codigo_local_estoque, k.cod_origem as o, k.quantidade as q,
           k.quantidade * coalesce(k.valor_unit, 0) as v_omie,
           k.valor_unit is null as sem,
           coalesce(k.valor_unit > r.limite and k.cod_origem not in ('COM', 'IMP', 'CIM', 'DCP', 'CDC'), false) as aj,
           r.referencia
    from kardex_omie k
    left join ref r on r.n_cod_prod = k.n_cod_prod
    where k.loja_id = p_loja_id and k.data_mov between p_ini and p_fim and not k.cancelado
  ), mov2 as (
    select m.*, case when m.aj then m.q * coalesce(m.referencia, 0) else m.v_omie end as v from mov m
  ), fluxo as (
    select n_cod_prod, codigo_local_estoque,
           sum(v) as liquido, sum(v_omie) as liquido_omie, sum(q) as liquido_q,
           coalesce(sum(v) filter (where o in ('COM', 'IMP', 'CIM', 'DCP', 'CDC')), 0) as compras,
           coalesce(sum(v) filter (where o = 'OPE'), 0) as producao,
           coalesce(-sum(v) filter (where o in ('PDV', 'VEN', 'DVP', 'CVP')), 0) as vendas,
           coalesce(-sum(q) filter (where o in ('PDV', 'VEN', 'DVP', 'CVP')), 0) as qtd_vendida,
           coalesce(-sum(v) filter (where o = 'OPS'), 0) as consumo_op,
           coalesce(sum(v) filter (where o not in ('COM', 'IMP', 'CIM', 'DCP', 'CDC', 'OPE', 'PDV', 'VEN', 'DVP', 'CVP', 'OPS') and q > 0), 0) as outras_entradas,
           coalesce(-sum(v) filter (where o not in ('COM', 'IMP', 'CIM', 'DCP', 'CDC', 'OPE', 'PDV', 'VEN', 'DVP', 'CVP', 'OPS') and q < 0), 0) as outras_saidas,
           coalesce(-sum(v_omie) filter (where o in ('PDV', 'VEN', 'DVP', 'CVP')), 0) as vendas_omie,
           coalesce(-sum(v_omie) filter (where o = 'OPS'), 0) as consumo_op_omie,
           coalesce(sum(v_omie) filter (where o = 'OPE'), 0) as producao_omie,
           count(*) filter (where sem)::int as sem_custo,
           count(*) filter (where aj)::int as ajustados,
           count(*) filter (where aj and referencia is null)::int as sem_referencia
    from mov2
    group by n_cod_prod, codigo_local_estoque
  ), saldos as (  -- EI e EF: saldo × CMC; o saldo que vem da foto já está valorizado pela regra da Posição (282/295)
    select s.dia, s.n_cod_prod, s.codigo_local_estoque, s.saldo, s.fonte,
           s.saldo * coalesce(s.cmc, 0) as valor_omie,
           s.saldo * case when s.aj then coalesce(s.referencia, 0) else coalesce(s.cmc, 0) end as valor,
           s.aj, s.referencia
    from (
      select x.*, coalesce(x.cmc > r.limite and x.saldo <> 0 and x.fonte <> 'foto', false) as aj, r.referencia
      from (select 'fim'::text as dia, c.* from saldo_em_data_completo(p_loja_id, p_fim) c
            union all
            select 'ini', c.* from saldo_em_data_completo(p_loja_id, p_ini - 1) c) x
      left join ref r on r.n_cod_prod = x.n_cod_prod
    ) s
  ), fim as (
    select * from saldos where dia = 'fim'
  ), ini as (
    select * from saldos where dia = 'ini'
  ), pl as (
    select coalesce(f.n_cod_prod, x.n_cod_prod) as n_cod_prod,
           coalesce(f.valor, 0) as ef, coalesce(f.valor_omie, 0) as ef_omie,
           -- com movimento no período: igual à 282 (kardex até a véspera; sem ele, EF − fluxo). Sem movimento: fonte nova.
           case when x.liquido is not null and i.fonte is distinct from 'kardex' then coalesce(f.valor, 0) - x.liquido
                else coalesce(i.valor, coalesce(f.valor, 0) - coalesce(x.liquido, 0)) end as ei,
           case when x.liquido is not null and i.fonte is distinct from 'kardex' then coalesce(f.valor_omie, 0) - x.liquido_omie
                else coalesce(i.valor_omie, coalesce(f.valor_omie, 0) - coalesce(x.liquido_omie, 0)) end as ei_omie,
           case when i.fonte = 'kardex' then abs(i.saldo + coalesce(x.liquido_q, 0) - coalesce(f.saldo, 0)) else 0 end as quebra,
           x.liquido, x.compras, x.producao, x.vendas, x.qtd_vendida, x.consumo_op, x.outras_entradas, x.outras_saidas, x.sem_custo,
           x.vendas_omie, x.consumo_op_omie, x.producao_omie,
           coalesce(x.ajustados, 0) as ajustados,
           (case when coalesce(f.aj, false) then 1 else 0 end) + (case when coalesce(i.aj, false) then 1 else 0 end) as ajustados_estoque,
           coalesce(x.sem_referencia, 0) + (case when coalesce(f.aj, false) and f.referencia is null then 1 else 0 end)
             + (case when coalesce(i.aj, false) and i.referencia is null then 1 else 0 end) as sem_referencia
    from fim f
    full join fluxo x on x.n_cod_prod = f.n_cod_prod and x.codigo_local_estoque = f.codigo_local_estoque
    left join ini i on i.n_cod_prod = coalesce(f.n_cod_prod, x.n_cod_prod) and i.codigo_local_estoque = coalesce(f.codigo_local_estoque, x.codigo_local_estoque)
  ), agg as (
    select pl.n_cod_prod,
           round(sum(pl.ei), 2) as ei, round(sum(coalesce(pl.compras, 0)), 2) as compras, round(sum(coalesce(pl.producao, 0)), 2) as producao,
           round(sum(coalesce(pl.outras_entradas, 0)), 2) as outras_entradas, round(sum(coalesce(pl.vendas, 0)), 2) as vendas,
           round(sum(coalesce(pl.qtd_vendida, 0)), 6) as qtd_vendida, round(sum(coalesce(pl.consumo_op, 0)), 2) as consumo_op,
           round(sum(coalesce(pl.outras_saidas, 0)), 2) as outras_saidas, round(sum(pl.ef), 2) as ef, sum(coalesce(pl.sem_custo, 0))::int as sem_custo,
           round(sum(case when pl.quebra > 0.01 then pl.quebra else 0 end), 6) as quebra,
           round(sum(coalesce(pl.vendas_omie, 0)), 2) as vendas_omie, round(sum(coalesce(pl.consumo_op_omie, 0)), 2) as consumo_op_omie,
           round(sum(coalesce(pl.producao_omie, 0)), 2) as producao_omie,
           round(sum(pl.ei_omie), 2) as ei_omie, round(sum(pl.ef_omie), 2) as ef_omie,
           sum(pl.ajustados)::int as ajustados, sum(pl.ajustados_estoque)::int as ajustados_estoque, sum(pl.sem_referencia)::int as sem_referencia,
           bool_or(pl.liquido is not null) as tem_mov
    from pl
    group by pl.n_cod_prod
  )
  select a.n_cod_prod, a.ei, a.compras, a.producao, a.outras_entradas, a.vendas, a.qtd_vendida, a.consumo_op, a.outras_saidas, a.ef,
         a.sem_custo, a.quebra, a.vendas_omie, a.consumo_op_omie, a.producao_omie, a.ei_omie, a.ef_omie,
         a.ajustados, a.ajustados_estoque, a.sem_referencia, r.referencia as custo_referencia
  from agg a
  left join ref r on r.n_cod_prod = a.n_cod_prod
  where a.tem_mov or a.ei <> 0 or a.ef <> 0 or a.ei_omie <> 0 or a.ef_omie <> 0  -- mesmos produtos da 282
  order by a.n_cod_prod
$$;
revoke all on function public.relatorio_cmv_kardex(bigint, date, date) from public, anon;
grant execute on function public.relatorio_cmv_kardex(bigint, date, date) to authenticated, service_role;

-- Uma chamada só (a tela lia em páginas de 1.000 e cada página rodava a função inteira de novo).
create function public.relatorio_cmv_kardex_json(p_loja_id bigint, p_ini date, p_fim date)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.n_cod_prod), '[]'::jsonb) from relatorio_cmv_kardex(p_loja_id, p_ini, p_fim) r);
end
$$;
revoke all on function public.relatorio_cmv_kardex_json(bigint, date, date) from public, anon;
grant execute on function public.relatorio_cmv_kardex_json(bigint, date, date) to authenticated, service_role;

-- Movimentação "valor do movimento" (188): mesma troca nos movimentos do kardex (loja Omie). A loja de estoque próprio
-- (estoque_movimentos, custo do ledger) não muda. Colunas novas: valor_omie (cru) e ajustados.
drop function if exists public.relatorio_movimentacao_valor_mov_json(bigint, date, date);
drop function if exists public.relatorio_movimentacao_valor_mov(bigint, date, date);
create function public.relatorio_movimentacao_valor_mov(p_loja_id bigint, p_ini date, p_fim date)
returns table (origem text, sentido text, codigo_local_estoque bigint, n_cod_prod bigint, mes text, inventario boolean, qtde numeric, valor numeric, sem_custo integer, valor_omie numeric, ajustados integer)
language sql stable security invoker set search_path = public as $$
  with modo as (select coalesce((select l.modo_estoque from lojas l where l.id = p_loja_id), 'omie') as m),
  ref as (
    select * from custo_referencia_produto(p_loja_id, p_fim) where (select m from modo) <> 'proprio'
  ),
  base as (
    select coalesce(nullif(k.des_origem, ''), nullif(k.cod_origem, ''), 'Sem origem') as origem,
           case when k.quantidade > 0 then 'E' else 'S' end as sentido,
           k.codigo_local_estoque, k.n_cod_prod, to_char(k.data_mov, 'YYYY-MM') as mes,
           (k.cod_origem = 'INV' or coalesce(mv.motivo = 'INV', false)) as inventario,
           abs(k.quantidade) as q,
           abs(k.quantidade) * case when k.valor_unit > r.limite and k.cod_origem not in ('COM', 'IMP', 'CIM', 'DCP', 'CDC')
                                    then coalesce(r.referencia, 0) else coalesce(k.valor_unit, 0) end as v,
           abs(k.quantidade) * coalesce(k.valor_unit, 0) as v_omie,
           k.valor_unit is null as sem,
           coalesce(k.valor_unit > r.limite and k.cod_origem not in ('COM', 'IMP', 'CIM', 'DCP', 'CDC'), false) as aj
    from kardex_omie k
    left join movimentos mv on mv.loja_id = k.loja_id and mv.id_ajuste = k.id_ajuste and k.id_ajuste is not null
    left join ref r on r.n_cod_prod = k.n_cod_prod
    where (select m from modo) <> 'proprio'
      and k.loja_id = p_loja_id and k.data_mov between p_ini and p_fim and not k.cancelado and k.quantidade <> 0
    union all
    select case e.origem
             when 'COMPRA' then 'Compra de Produto'
             when 'VENDA' then 'Venda'
             when 'PRODUCAO' then case when e.quantidade < 0 then 'Consumo da Ordem de Produção' else 'Entrada da Ordem de Produção' end
             when 'INVENTARIO' then 'Inventário'
             when 'PERDA' then 'Perda'
             when 'TRANSFERENCIA' then 'Transferência'
             when 'ESTORNO' then 'Estorno'
             else initcap(replace(lower(e.origem), '_', ' ')) end,
           case when e.quantidade > 0 then 'E' else 'S' end,
           e.codigo_local_estoque, e.codigo_produto, to_char(e.data_ref, 'YYYY-MM'),
           e.origem = 'INVENTARIO',
           abs(e.quantidade), abs(e.quantidade) * coalesce(e.custo_unitario, 0), abs(e.quantidade) * coalesce(e.custo_unitario, 0),
           e.custo_unitario is null, false
    from estoque_movimentos e
    where (select m from modo) = 'proprio'
      and e.loja_id = p_loja_id and e.data_ref between p_ini and p_fim
  )
  select origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario,
         round(sum(q), 6), round(sum(v), 2), count(*) filter (where sem)::int, round(sum(v_omie), 2), count(*) filter (where aj)::int
  from base
  group by origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario
  order by origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario
$$;
revoke all on function public.relatorio_movimentacao_valor_mov(bigint, date, date) from public, anon;
grant execute on function public.relatorio_movimentacao_valor_mov(bigint, date, date) to authenticated, service_role;

create function public.relatorio_movimentacao_valor_mov_json(p_loja_id bigint, p_ini date, p_fim date)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.origem, r.sentido, r.codigo_local_estoque, r.n_cod_prod, r.mes, r.inventario), '[]'::jsonb)
          from relatorio_movimentacao_valor_mov(p_loja_id, p_ini, p_fim) r);
end
$$;
revoke all on function public.relatorio_movimentacao_valor_mov_json(bigint, date, date) from public, anon;
grant execute on function public.relatorio_movimentacao_valor_mov_json(bigint, date, date) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
