-- 283: Paridade numérica com o Omie (bug B6 de omie-rea/gaps/paridade-numerica-2026-10-20.md) — Estoque Valorizado
-- soma os saldos negativos, como o Omie e como a tela de Posição de estoque. Um total só no sistema.
--
-- Antes (087 / 091): `where pos.n_saldo > 0 and pos.valor_total > 0` — o saldo negativo (permitido no Omie, E4) saía
-- do total; na foto do Omie de 17/10 isso era −91.461 (loja 5).
--
-- Agora as duas RPCs (CREATE OR REPLACE, mesma assinatura e colunas) leem posicao_valorizada (migration 282): a foto mais
-- recente com local real, sentinela 0 fora, valor por local = saldo × CMC com o CMC SUSPEITO trocado pela referência de
-- custo do produto (regra no cabeçalho da 282 — sem ela a loja 3 ia de R$ 1,30 mi para −R$ 140 mi com 4 pratos de CMC
-- absurdo em saldo negativo). Negativos e produto sem cadastro entram no total.
--   Por produto: saldo e valor somam todos os locais (negativos inclusive); CMC e margem do produto vêm só dos locais com
--   saldo positivo (como a Margem), para um local negativo não distorcer o custo mostrado.
--   Por local: CMC = o usado no valor (o do Omie, ou a referência quando suspeito).
--   p_local filtra os locais (a foto é sempre a mais recente da loja).
-- As linhas ajustadas e o valor cru do Omie saem de posicao_valorizada (`suspeito`, `valor_omie`) para o aviso da tela.
--
-- Prova (produção, só leitura, 20/10/2026): ver AGENTS.md "Paridade numérica 20/10".
-- Aplicar DEPOIS da 282 (usa posicao_valorizada):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 283_estoque_valorizado_com_negativos.sql
-- Reverter: reaplicar 087 (relatorio_estoque_valorizado) e 091 (relatorio_estoque_valorizado_local).
-- Teste: scripts/testes-sql/283_estoque_valorizado_com_negativos.sql (banco local).

begin;

create or replace function public.relatorio_estoque_valorizado(p_loja_id bigint, p_familia text[] default null::text[], p_tipo text[] default null::text[], p_local bigint[] default null::bigint[], p_busca text default null::text)
 returns table(codigo_produto bigint, codigo text, descricao text, descricao_familia text, tipo_item text, unidade text, n_saldo numeric, n_cmc numeric, n_preco_unitario numeric, margem_pct numeric, valor_total numeric, data_foto date)
 language sql
 stable
as $function$
  with v as (
    select * from posicao_valorizada(p_loja_id)
    where p_local is null or codigo_local_estoque = any(p_local)
  ),
  pos as (
    select
      v.n_cod_prod,
      max(v.data_posicao) as data_foto,
      sum(v.n_saldo) as n_saldo,
      sum(v.valor) as valor_total,
      -- CMC do produto só dos locais com saldo positivo (como a Margem)
      sum(v.valor) filter (where v.n_saldo > 0) / nullif(sum(v.n_saldo) filter (where v.n_saldo > 0), 0) as cmc_pos
    from v
    group by v.n_cod_prod
  )
  select
    pos.n_cod_prod as codigo_produto,
    p.codigo::text,
    coalesce(p.descricao, 'Produto ' || pos.n_cod_prod)::text,
    p.descricao_familia::text,
    p.tipo_item::text,
    p.unidade::text,
    pos.n_saldo,
    pos.cmc_pos as n_cmc,
    p.valor_unitario::numeric as n_preco_unitario,
    case
      when p.valor_unitario > 0 and pos.cmc_pos > 0
      then round(((p.valor_unitario - pos.cmc_pos) / p.valor_unitario) * 100, 1)
      else null
    end as margem_pct,
    pos.valor_total,
    pos.data_foto
  from pos
  left join produtos p on p.codigo_produto = pos.n_cod_prod and p.loja_id = p_loja_id
  where (pos.n_saldo <> 0 or pos.valor_total <> 0)
    and (p_familia is null or p.descricao_familia = any(p_familia))
    and (p_tipo    is null or p.tipo_item          = any(p_tipo))
    and (p_busca   is null or p_busca = ''
         or p.descricao ilike '%' || p_busca || '%'
         or p.codigo    ilike '%' || p_busca || '%')
  order by pos.valor_total desc, pos.n_cod_prod asc
$function$;

create or replace function public.relatorio_estoque_valorizado_local(p_loja_id bigint, p_familia text[] default null::text[], p_tipo text[] default null::text[], p_local bigint[] default null::bigint[], p_busca text default null::text)
 returns table(codigo_produto bigint, codigo text, descricao text, descricao_familia text, tipo_item text, unidade text, codigo_local_estoque bigint, local_descricao text, n_saldo numeric, n_cmc numeric, valor_total numeric, data_foto date, data_ultimo_inventario date)
 language sql
 stable
as $function$
  with v as (
    select * from posicao_valorizada(p_loja_id)
    where p_local is null or codigo_local_estoque = any(p_local)
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
    v.n_cod_prod as codigo_produto,
    p.codigo::text,
    coalesce(p.descricao, 'Produto ' || v.n_cod_prod)::text,
    p.descricao_familia::text,
    p.tipo_item::text,
    p.unidade::text,
    v.codigo_local_estoque,
    le.descricao::text as local_descricao,
    v.n_saldo,
    v.cmc_usado as n_cmc,
    v.valor as valor_total,
    v.data_posicao as data_foto,
    u.data_ultimo_inventario
  from v
  left join produtos p on p.codigo_produto = v.n_cod_prod and p.loja_id = p_loja_id
  left join local_estoques le
    on le.codigo_local_estoque = v.codigo_local_estoque and le.loja_id = p_loja_id
  left join ultimos u
    on u.n_cod_prod = v.n_cod_prod and u.codigo_local_estoque = v.codigo_local_estoque
  where (v.n_saldo <> 0 or v.valor <> 0)
    and (p_familia is null or p.descricao_familia = any(p_familia))
    and (p_tipo    is null or p.tipo_item          = any(p_tipo))
    and (p_busca   is null or p_busca = ''
         or p.descricao ilike '%' || p_busca || '%'
         or p.codigo    ilike '%' || p_busca || '%')
  order by v.valor desc, v.n_cod_prod asc, v.codigo_local_estoque asc
$function$;

commit;

notify pgrst, 'reload schema';
