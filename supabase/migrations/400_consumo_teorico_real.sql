-- 400 — Fase 5 (T5.3 e T5.4): consumo teórico × real por insumo e variação de preço na nota. Só LEITURA, só estoque próprio.
-- Plano: docs/superpowers/plans/2026-11-03-norte-erp-plano-mestre.md (Fase 5, T5.3/T5.4).
-- Depende da 134/137 (inventarios + inventario_items no estoque próprio), 311/351 (estoque_movimentos_efetivo).
--
-- 1) estoque_config.alerta_variacao_preco_pct: limite (%) do alerta de variação de preço na nota, por loja. Padrão 15%.
--
-- 2) consumo_teorico_real(loja, ini, fim, local): uma linha por local × produto.
--    TEÓRICO = o que a ficha mandou baixar: saídas de VENDA (consumo_por_receita, origem VENDA) + consumo de insumo das
--              OPs (PRODUCAO com quantidade negativa). Estorno conta pelo movimento que ele desfaz.
--    REAL    = saldo contado no 1º inventário do período + entradas − saldo contado no último inventário do período.
--              "Entradas" = tudo que mexeu no saldo entre as duas contagens, exceto: venda e consumo de OP (teórico),
--              ajustes de inventário (são as próprias contagens), ajuste manual e perda (ficam em ajustes_perdas: saíram de
--              verdade, então já estão no real; a coluna mostra quanto do desvio tem motivo lançado).
--              Compra, entrada manual, produção do próprio item, transferência (entra +, sai −) e devolução (−) são "entradas".
--    DESVIO  = real − teórico (quantidade) e × custo efetivo (CMC da visão estoque_movimentos_efetivo no fim do período,
--              senão o CMC atual de estoque_custos).
--    Contagem = item 'Concluido' de inventário da loja/local com data (Bahia) no período e quantidade contada. O instante da
--    contagem no ledger é o próprio ajuste do item (id_ajuste); sem diferença (sem ajuste), o último movimento do
--    produto/local até o envio do item. A janela vai do movimento seguinte à 1ª contagem até a última (por id do ledger).
--    Menos de duas contagens no período: situacao = 'sem_contagem' e só o teórico (por data do movimento) — nada inventado.
--
-- 3) variacao_preco_compras(loja, ini, fim, compra): preço de cada item da nota por unidade de estoque
--    ((valor dos produtos − desconto) ÷ quantidade recebida na unidade de estoque) × o da compra anterior do mesmo produto
--    (nota lançada, não cancelada, anterior pela data da nota); sem compra anterior, × o custo médio atual (fonte 'cmc').
--    O limite (%) é aplicado pela tela (lib/compras/variacao-preco-puro.ts), lendo a coluna do item 1.
--
-- Funções SECURITY DEFINER só para service_role: a tela confere permissão (gestão + desenvolvedor) antes de chamar.
-- Teste em produção, em ROLLBACK, loja 19: bash scripts/testes-sql/400_rodar.sh  →  NOTICE "400 CONSUMO TEORICO REAL OK"
-- Aplicar (com backup e OK do dono, depois de 01:00): node scripts/aplicar-migration.mjs supabase/migrations/400_consumo_teorico_real.sql
-- Depois: desktop/scripts/gerar-schema.sh (coluna nova em estoque_config, que desce para o desktop).

begin;

alter table public.estoque_config add column if not exists alerta_variacao_preco_pct numeric(7,2) not null default 15;
alter table public.estoque_config drop constraint if exists estoque_config_alerta_variacao_preco_pct_check;
alter table public.estoque_config add constraint estoque_config_alerta_variacao_preco_pct_check
  check (alerta_variacao_preco_pct > 0 and alerta_variacao_preco_pct <= 1000);

create or replace function public.consumo_teorico_real(p_loja bigint, p_ini date, p_fim date, p_local bigint default null)
returns table (
  codigo_local_estoque bigint, codigo_produto bigint, situacao text, contagens int,
  inventario_ini bigint, inventario_fim bigint, contado_ini_em timestamptz, contado_fim_em timestamptz,
  saldo_ini numeric, saldo_fim numeric, entradas numeric, teorico_venda numeric, teorico_op numeric, teorico numeric,
  ajustes_perdas numeric, consumo_real numeric, desvio numeric, custo_unitario numeric, custo_estimado boolean,
  teorico_valor numeric, real_valor numeric, desvio_valor numeric
)
language sql stable security definer set search_path = public as $$
  with contagem as (
    select i.codigo_local_estoque as loc, it.produto_codigo_produto as prod, it.quan as qtd, i.id as inv,
           coalesce(it.id_ajuste, (
             select max(m.id) from estoque_movimentos m
              where m.loja_id = p_loja and m.codigo_produto = it.produto_codigo_produto
                and m.codigo_local_estoque = i.codigo_local_estoque
                and m.created_at <= coalesce(it.ultima_tentativa_em, it.updated_at)), 0) as corte,
           coalesce(it.ultima_tentativa_em, it.updated_at) as em
      from inventarios i
      join inventario_items it on it.inventario_id = i.id and it.loja_id = i.loja_id
     where i.loja_id = p_loja
       and (p_local is null or i.codigo_local_estoque = p_local)
       and (i.data at time zone 'America/Bahia')::date between p_ini and p_fim
       and it.status = 'Concluido' and it.quan is not null and it.produto_codigo_produto is not null
  ),
  ordenada as (
    select c.*, count(*) over w as n,
           row_number() over (partition by c.loc, c.prod order by c.corte, c.em, c.inv) as asc_,
           row_number() over (partition by c.loc, c.prod order by c.corte desc, c.em desc, c.inv desc) as desc_
      from contagem c
    window w as (partition by c.loc, c.prod)
  ),
  janela as (
    select a.loc, a.prod, a.n::int as n, a.inv as inv0, a.em as em0, a.qtd as q0, a.corte as c0,
           b.inv as inv1, b.em as em1, b.qtd as q1, b.corte as c1
      from ordenada a join ordenada b on b.loc = a.loc and b.prod = a.prod and b.desc_ = 1
     where a.asc_ = 1 and a.n >= 2 and b.corte > a.corte
  ),
  -- Movimentos classificados (estorno pela origem e pelo sinal do movimento desfeito).
  classe as (
    select m.id, m.codigo_local_estoque as loc, m.codigo_produto as prod, m.quantidade as q, m.data_ref,
           case
             when coalesce(o.origem, m.origem) = 'VENDA' then 'venda'
             when coalesce(o.origem, m.origem) = 'PRODUCAO' and coalesce(o.quantidade, m.quantidade) < 0 then 'op'
             when coalesce(o.origem, m.origem) = 'INVENTARIO' then 'inventario'
             when coalesce(o.origem, m.origem) in ('AJUSTE_MANUAL', 'PERDA') then 'ajuste'
             else 'entrada'
           end as cls
      from estoque_movimentos m
      left join estoque_movimentos o on m.tipo = 'EST' and o.id = m.reverses_id
     where m.loja_id = p_loja and (p_local is null or m.codigo_local_estoque = p_local)
  ),
  com_contagem as (
    select j.loc, j.prod, 'ok'::text as situacao, j.n, j.inv0, j.inv1, j.em0, j.em1, j.q0, j.q1,
           coalesce(sum(c.q) filter (where c.cls = 'entrada'), 0) as ent,
           coalesce(-sum(c.q) filter (where c.cls = 'venda'), 0) as tv,
           coalesce(-sum(c.q) filter (where c.cls = 'op'), 0) as tp,
           coalesce(-sum(c.q) filter (where c.cls = 'ajuste'), 0) as aj
      from janela j
      left join classe c on c.loc = j.loc and c.prod = j.prod and c.id > j.c0 and c.id <= j.c1
     group by j.loc, j.prod, j.n, j.inv0, j.inv1, j.em0, j.em1, j.q0, j.q1
  ),
  sem_contagem as (
    select c.loc, c.prod, 'sem_contagem'::text as situacao,
           coalesce((select max(o.n) from ordenada o where o.loc = c.loc and o.prod = c.prod), 0)::int as n,
           null::bigint as inv0, null::bigint as inv1, null::timestamptz as em0, null::timestamptz as em1,
           null::numeric as q0, null::numeric as q1, null::numeric as ent,
           coalesce(-sum(c.q) filter (where c.cls = 'venda'), 0) as tv,
           coalesce(-sum(c.q) filter (where c.cls = 'op'), 0) as tp,
           coalesce(-sum(c.q) filter (where c.cls = 'ajuste'), 0) as aj
      from classe c
     where c.data_ref between p_ini and p_fim and c.cls in ('venda', 'op', 'ajuste')
       and not exists (select 1 from janela j where j.loc = c.loc and j.prod = c.prod)
     group by c.loc, c.prod
    having coalesce(sum(c.q) filter (where c.cls in ('venda', 'op')), 0) <> 0
  ),
  linhas as (select * from com_contagem union all select * from sem_contagem),
  custo as (
    select l.prod, coalesce(e.cmc_apos, ec.cmc) as cmc, coalesce(e.custo_estimado, false) or coalesce(e.cmc_apos, ec.cmc, 0) <= 0 as estimado
      from (select distinct prod from linhas) l
      left join lateral (
        select x.cmc_apos, x.custo_estimado from estoque_movimentos_efetivo x
         where x.loja_id = p_loja and x.codigo_produto = l.prod and x.data_ref <= p_fim
         order by x.data_ref desc, x.id desc limit 1
      ) e on true
      left join estoque_custos ec on ec.loja_id = p_loja and ec.codigo_produto = l.prod
  )
  select l.loc, l.prod, l.situacao, l.n, l.inv0, l.inv1, l.em0, l.em1,
         round(l.q0, 6), round(l.q1, 6), round(l.ent, 6), round(l.tv, 6), round(l.tp, 6), round(l.tv + l.tp, 6),
         round(l.aj, 6),
         round(l.q0 + l.ent - l.q1, 6),
         round(l.q0 + l.ent - l.q1 - (l.tv + l.tp), 6),
         round(k.cmc, 6), k.estimado,
         round((l.tv + l.tp) * coalesce(k.cmc, 0), 2),
         round((l.q0 + l.ent - l.q1) * coalesce(k.cmc, 0), 2),
         round((l.q0 + l.ent - l.q1 - (l.tv + l.tp)) * coalesce(k.cmc, 0), 2)
    from linhas l
    left join custo k on k.prod = l.prod
   order by l.situacao, abs(coalesce((l.q0 + l.ent - l.q1 - (l.tv + l.tp)) * coalesce(k.cmc, 0), 0)) desc, l.loc, l.prod
$$;

comment on function public.consumo_teorico_real(bigint, date, date, bigint) is
  'T5.3 (400): consumo teórico (venda + OP) × real (contagem inicial + entradas − contagem final) por local e produto, '
  'com o desvio em R$ pelo custo efetivo. Sem duas contagens no período: sem_contagem, só o teórico.';

create or replace function public.variacao_preco_compras(p_loja bigint, p_ini date, p_fim date, p_compra bigint default null)
returns table (
  compra_id bigint, nota_fiscal_id bigint, numero text, fornecedor_nome text, data_compra date, status text,
  item_id bigint, linha int, codigo_produto bigint, descricao text, quantidade_base numeric, preco_base numeric,
  preco_anterior numeric, data_anterior date, compra_anterior bigint, fonte_anterior text, variacao_pct numeric
)
language sql stable security definer set search_path = public as $$
  with itens as (
    select c.id as cid, c.nota_fiscal_id, c.numero, c.fornecedor_nome, c.status,
           coalesce(c.emissao, (c.lancada_em at time zone 'America/Bahia')::date, (c.created_at at time zone 'America/Bahia')::date) as dt,
           i.id as iid, i.linha, i.codigo_produto, i.descricao,
           coalesce(i.quantidade_recebida, i.quantidade * nullif(i.fator, 0)) as qb,
           (i.valor_total - i.desconto) / nullif(coalesce(i.quantidade_recebida, i.quantidade * nullif(i.fator, 0)), 0) as pb
      from compras_proprio c
      join compras_proprio_itens i on i.compra_id = c.id and i.loja_id = c.loja_id
     where c.loja_id = p_loja and i.codigo_produto is not null
       and (case when p_compra is not null then c.id = p_compra
                 else c.status <> 'cancelada'
                      and coalesce(c.emissao, (c.lancada_em at time zone 'America/Bahia')::date, (c.created_at at time zone 'America/Bahia')::date)
                          between p_ini and p_fim end)
  ),
  -- Compras anteriores possíveis: itens lançados, de nota não cancelada, dos produtos da lista (lidos uma vez só).
  hist as materialized (
    select c2.id as cid, i2.codigo_produto as prod, i2.linha,
           coalesce(c2.emissao, (c2.lancada_em at time zone 'America/Bahia')::date, (c2.created_at at time zone 'America/Bahia')::date) as dt,
           (i2.valor_total - i2.desconto) / nullif(coalesce(i2.quantidade_recebida, i2.quantidade * nullif(i2.fator, 0)), 0) as pb
      from compras_proprio_itens i2
      join compras_proprio c2 on c2.id = i2.compra_id and c2.loja_id = i2.loja_id
     where i2.loja_id = p_loja and i2.lancado and c2.status <> 'cancelada'
       and i2.codigo_produto in (select distinct codigo_produto from itens)
       and coalesce(i2.quantidade_recebida, i2.quantidade * nullif(i2.fator, 0)) > 0
  )
  select t.cid, t.nota_fiscal_id, t.numero, t.fornecedor_nome, t.dt, t.status, t.iid, t.linha, t.codigo_produto, t.descricao,
         round(t.qb, 6), round(t.pb, 6),
         round(coalesce(a.pb, case when ec.cmc > 0 then ec.cmc end), 6),
         a.dt, a.cid, case when a.pb is not null then 'compra' when ec.cmc > 0 then 'cmc' end,
         round((t.pb / nullif(coalesce(a.pb, case when ec.cmc > 0 then ec.cmc end), 0) - 1) * 100, 2)
    from itens t
    left join lateral (
      select h.cid, h.dt, h.pb from hist h
       where h.prod = t.codigo_produto and h.cid <> t.cid and (h.dt, h.cid) < (t.dt, t.cid)
       order by h.dt desc, h.cid desc, h.linha desc
       limit 1
    ) a on true
    left join estoque_custos ec on ec.loja_id = p_loja and ec.codigo_produto = t.codigo_produto
   order by t.dt desc, t.cid desc, t.linha
$$;

comment on function public.variacao_preco_compras(bigint, date, date, bigint) is
  'T5.4 (400): preço do item da nota por unidade de estoque × o da compra anterior do produto (ou o CMC atual), em %.';

do $$ declare f text; begin
  foreach f in array array['consumo_teorico_real(bigint,date,date,bigint)', 'variacao_preco_compras(bigint,date,date,bigint)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
