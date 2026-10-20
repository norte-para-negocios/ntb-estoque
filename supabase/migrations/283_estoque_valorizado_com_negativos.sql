-- 283: Paridade numérica com o Omie (bug B6 de omie-rea/gaps/paridade-numerica-2026-10-20.md) — Estoque Valorizado
-- soma os saldos negativos, como o Omie e como a tela nova de Posição de estoque. Um total só no sistema.
--
-- Antes (087 / 091): `where pos.n_saldo > 0 and pos.valor_total > 0` — o saldo negativo (permitido no Omie, E4) saía
-- do total; na foto do Omie de 17/10 isso era −91.461 (loja 5). Hoje (20/10) a RPC dava 1.957.785,63 e a tela de
-- Posição (lib/relatorios/posicao-estoque-puro.ts, mesma foto) 1.543.731,58.
--
-- Agora as duas RPCs usam as regras da Posição (CREATE OR REPLACE, mesma assinatura e colunas):
--   foto = a data mais recente com linha de local real (a sentinela 0 do sync — mínimo + CMC do produto — nunca é linha);
--   valor por local = round(saldo × CMC, 2), CMC fora de (0, 1e7) vale 0 (custo suspeito, mesmo critério da tela);
--   entra toda linha com saldo ou valor ≠ 0 (negativos inclusive); produto sem cadastro também entra (como na Posição);
--   CMC do produto = valor ÷ saldo; margem só com CMC > 0.
--   p_local continua filtrando os locais (e a foto, como antes).
--
-- Prova (produção, só leitura, 20/10/2026, corpo novo rodado como consulta): ver AGENTS.md "Paridade numérica 20/10".
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 283_estoque_valorizado_com_negativos.sql
-- Reverter: reaplicar 087 (relatorio_estoque_valorizado) e 091 (relatorio_estoque_valorizado_local).
-- Teste: scripts/testes-sql/283_estoque_valorizado_com_negativos.sql (banco local).

begin;

create or replace function public.relatorio_estoque_valorizado(p_loja_id bigint, p_familia text[] default null::text[], p_tipo text[] default null::text[], p_local bigint[] default null::bigint[], p_busca text default null::text)
 returns table(codigo_produto bigint, codigo text, descricao text, descricao_familia text, tipo_item text, unidade text, n_saldo numeric, n_cmc numeric, n_preco_unitario numeric, margem_pct numeric, valor_total numeric, data_foto date)
 language sql
 stable
as $function$
  with foto as (
    select max(data_posicao) as d
    from posicao_estoques
    where loja_id = p_loja_id
      and codigo_local_estoque <> 0
      and (p_local is null or codigo_local_estoque = any(p_local))
  ),
  pos as (
    select
      pe.n_cod_prod,
      sum(pe.n_saldo) as n_saldo,
      -- por local: saldo × CMC (negativo entra; CMC fora de (0, 1e7) = suspeito, vale 0), igual à tela de Posição
      sum(round(pe.n_saldo * case when pe.n_cmc > 0 and pe.n_cmc < 10000000 then pe.n_cmc else 0 end, 2)) as valor_total
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
      and pe.codigo_local_estoque <> 0
      and (p_local is null or pe.codigo_local_estoque = any(p_local))
    group by pe.n_cod_prod
  )
  select
    pos.n_cod_prod as codigo_produto,
    p.codigo::text,
    coalesce(p.descricao, 'Produto ' || pos.n_cod_prod)::text,
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
  left join produtos p on p.codigo_produto = pos.n_cod_prod and p.loja_id = p_loja_id
  cross join foto
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
  with foto as (
    select max(data_posicao) as d
    from posicao_estoques
    where loja_id = p_loja_id
      and codigo_local_estoque <> 0
      and (p_local is null or codigo_local_estoque = any(p_local))
  ),
  pos as (
    select
      pe.n_cod_prod,
      pe.codigo_local_estoque,
      pe.n_saldo,
      case when pe.n_cmc > 0 and pe.n_cmc < 10000000 then pe.n_cmc else 0 end as n_cmc,
      round(pe.n_saldo * case when pe.n_cmc > 0 and pe.n_cmc < 10000000 then pe.n_cmc else 0 end, 2) as valor_total
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
      and pe.codigo_local_estoque <> 0
      and (p_local is null or pe.codigo_local_estoque = any(p_local))
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
    pos.n_cod_prod as codigo_produto,
    p.codigo::text,
    coalesce(p.descricao, 'Produto ' || pos.n_cod_prod)::text,
    p.descricao_familia::text,
    p.tipo_item::text,
    p.unidade::text,
    pos.codigo_local_estoque,
    le.descricao::text as local_descricao,
    pos.n_saldo,
    pos.n_cmc,
    pos.valor_total,
    foto.d as data_foto,
    u.data_ultimo_inventario
  from pos
  left join produtos p on p.codigo_produto = pos.n_cod_prod and p.loja_id = p_loja_id
  left join local_estoques le
    on le.codigo_local_estoque = pos.codigo_local_estoque and le.loja_id = p_loja_id
  left join ultimos u
    on u.n_cod_prod = pos.n_cod_prod and u.codigo_local_estoque = pos.codigo_local_estoque
  cross join foto
  where (pos.n_saldo <> 0 or pos.valor_total <> 0)
    and (p_familia is null or p.descricao_familia = any(p_familia))
    and (p_tipo    is null or p.tipo_item          = any(p_tipo))
    and (p_busca   is null or p_busca = ''
         or p.descricao ilike '%' || p_busca || '%'
         or p.codigo    ilike '%' || p_busca || '%')
  order by pos.valor_total desc, pos.n_cod_prod asc, pos.codigo_local_estoque asc
$function$;

commit;

notify pgrst, 'reload schema';
