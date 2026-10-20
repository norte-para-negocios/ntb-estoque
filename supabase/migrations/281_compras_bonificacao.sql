-- 281: Paridade numérica com o Omie (bug B2 de omie-rea/gaps/paridade-numerica-2026-10-20.md) — bonificação nas
-- RPCs de Compras, só quando pedida.
--
-- O Omie conta a bonificação (CFOP de entrada x.910) no estoque COM valor: em out/2026 (loja 5) 2 itens, 5.743,24 de
-- valor de estoque e 6.446,28 de valor da nota que as RPCs de Compras tiram desde a 065 (regra R7/R8 do NTB:
-- "bonificação e comodato não são compra"). Comodato (x.908) segue junto com a bonificação, como sempre andaram.
--
-- Mudança: parâmetro novo `p_bonificacao boolean default false` em relatorio_compras_total, _matriz, _dim e _detalhe.
--   false (padrão) = comportamento de sempre, byte a byte (mesmo WHERE da 192);
--   true           = inclui os itens x.910/x.908 (o resto do WHERE igual) — o que a tela de Compras pede em
--                    "Valor de estoque" (como o Omie). "Valor da nota" continua sem bonificação.
-- relatorio_compras_total ganha 2 colunas no fim: valor_bonificacao e valor_estoque_bonificacao (a parte bonificação do
-- total devolvido; 0 quando p_bonificacao = false), para a tela mostrar a linha "Bonificação" sem outra chamada.
--
-- Consumidores (decisão por consumidor, ver AGENTS.md "Paridade numérica 20/10"):
--   Compras (tela, Excel, Baixar tudo): p_bonificacao = true só em "Valor de estoque", com a linha "Bonificação" visível;
--   Indicadores (Faturamento × Compras), relatório mensal (PPTX), painel gerencial, compras × faturamento/meta: NÃO
--   passam o parâmetro — continuam sem bonificação (compra paga; a razão Compras ÷ Faturamento não muda de sentido) e
--   a tela/slide diz "sem bonificação".
--
-- Assinatura muda (parâmetro novo) → DROP + CREATE (CREATE OR REPLACE não muda a lista de parâmetros e deixaria duas
-- versões, o que o PostgREST não consegue escolher). Chamadas antigas (sem o parâmetro) continuam valendo pelo padrão,
-- então a migration pode ir ANTES do código. O código novo chama com `p_bonificacao` e precisa da migration (sem ela a
-- tela de Compras em "Valor de estoque" mostra o aviso de falha da RPC).
-- Corpos: os da 192 (total/matriz/dim, md5 igual a produção em 20/10) e o de produção de relatorio_compras_detalhe
-- (pg_get_functiondef, 20/10), só com o parâmetro e a condição novos.
--
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 281_compras_bonificacao.sql
-- Depois: desktop/scripts/gerar-schema.sh se o desktop usar estas RPCs (não usa hoje: relatórios só com internet).
-- Reverter: drop das 4 funções novas e reaplicar 192 (total/matriz/dim) + o detalhe da 176.
-- Teste: scripts/testes-sql/281_compras_bonificacao.sql (banco local).

begin;

drop function if exists public.relatorio_compras_total(bigint, date, date, text[], text[], text, text[], text, bigint, text);
drop function if exists public.relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[], text, bigint, text);
drop function if exists public.relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[], text, bigint, text);
drop function if exists public.relatorio_compras_detalhe(bigint, date, date, text[], text[], text, text[], text, bigint, text);

create function public.relatorio_compras_total(p_loja_id bigint, p_ini date, p_fim date, p_familias text[] default null::text[], p_tipos text[] default null::text[], p_fornecedor text default null::text, p_cfops text[] default null::text[], p_produto text default null::text, p_local bigint default null::bigint, p_status text default 'CONCLUIDA'::text, p_bonificacao boolean default false)
 returns table(valor numeric, n_notas bigint, valor_estoque numeric, valor_bonificacao numeric, valor_estoque_bonificacao numeric)
 language sql
 stable
as $function$
  select
    coalesce(sum(x.fiscal), 0)::numeric,
    count(distinct x.nf_id)::bigint,
    coalesce(sum(x.estoque), 0)::numeric,
    coalesce(sum(x.fiscal) filter (where x.bonif), 0)::numeric,
    coalesce(sum(x.estoque) filter (where x.bonif), 0)::numeric
  from (
    select nf.id as nf_id,
           coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0) as fiscal,
           custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) as estoque,
           right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) in ('910', '908') as bonif
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
    left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
    where i.loja_id = p_loja_id
      and nf.deleted_at is null
      and item_movimenta_estoque(i.full_object)
      and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
      and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
      and (p_familias is null
           or ('__sem__' = any(p_familias) and p.descricao_familia is null)
           or p.descricao_familia = any(p_familias))
      and (p_tipos is null
           or ('__sem__' = any(p_tipos) and p.tipo_item is null)
           or p.tipo_item = any(p_tipos))
      and (p_fornecedor is null
           or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
           or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
      and (p_cfops is null
           or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
           or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
      and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
      and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
      and (p_bonificacao or right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908'))
    offset 0
  ) x;
$function$;

create function public.relatorio_compras_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[] default null::text[], p_tipos text[] default null::text[], p_fornecedor text default null::text, p_cfops text[] default null::text[], p_produto text default null::text, p_local bigint default null::bigint, p_status text default 'CONCLUIDA'::text, p_bonificacao boolean default false)
 returns table(rotulo text, mes text, valor numeric, valor_estoque numeric)
 language sql
 stable
as $function$
  select x.rotulo, x.mes,
    sum(x.fiscal)::numeric as valor,
    coalesce(sum(x.estoque), 0)::numeric as valor_estoque
  from (
    select
      coalesce(nullif(
        case p_dim
          when 'familia'    then p.descricao_familia
          when 'tipo'       then p.tipo_item
          when 'produto'    then i.c_descricao_produto
          when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
          when 'cfop'       then i.full_object->'itensAjustes'->>'cCFOPEntrada'
        end, ''), 'Sem classificação') as rotulo,
      to_char(nf.d_emissao_nfe, 'YYYY-MM') as mes,
      coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0) as fiscal,
      custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) as estoque
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
    left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
    where i.loja_id = p_loja_id
      and nf.deleted_at is null
      and item_movimenta_estoque(i.full_object)
      and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
      and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
      and (p_familias is null
           or ('__sem__' = any(p_familias) and p.descricao_familia is null)
           or p.descricao_familia = any(p_familias))
      and (p_tipos is null
           or ('__sem__' = any(p_tipos) and p.tipo_item is null)
           or p.tipo_item = any(p_tipos))
      and (p_fornecedor is null
           or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
           or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
      and (p_cfops is null
           or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
           or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
      and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
      and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
      and (p_bonificacao or right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908'))
    offset 0
  ) x
  group by 1, 2
  order by 1, 2;
$function$;

create function public.relatorio_compras_dim(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[] default null::text[], p_tipos text[] default null::text[], p_fornecedor text default null::text, p_cfops text[] default null::text[], p_produto text default null::text, p_local bigint default null::bigint, p_status text default 'CONCLUIDA'::text, p_bonificacao boolean default false)
 returns table(rotulo text, valor numeric, itens bigint, valor_estoque numeric)
 language sql
 stable
as $function$
  select x.rotulo,
    sum(x.fiscal)::numeric as valor,
    count(*)::bigint as itens,
    coalesce(sum(x.estoque), 0)::numeric as valor_estoque
  from (
    select
      coalesce(nullif(
        case p_dim
          when 'familia'    then p.descricao_familia
          when 'tipo'       then p.tipo_item
          when 'produto'    then i.c_descricao_produto
          when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
          when 'cfop'       then i.full_object->'itensAjustes'->>'cCFOPEntrada'
        end, ''), 'Sem classificação') as rotulo,
      coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0) as fiscal,
      custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) as estoque
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
    left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
    where i.loja_id = p_loja_id
      and nf.deleted_at is null
      and item_movimenta_estoque(i.full_object)
      and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
      and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
      and (p_familias is null
           or ('__sem__' = any(p_familias) and p.descricao_familia is null)
           or p.descricao_familia = any(p_familias))
      and (p_tipos is null
           or ('__sem__' = any(p_tipos) and p.tipo_item is null)
           or p.tipo_item = any(p_tipos))
      and (p_fornecedor is null
           or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
           or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
      and (p_cfops is null
           or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
           or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
      and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
      and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
      and (p_bonificacao or right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908'))
    offset 0
  ) x
  group by 1
  order by valor desc;
$function$;

create function public.relatorio_compras_detalhe(p_loja_id bigint, p_ini date, p_fim date, p_familias text[] DEFAULT NULL::text[], p_tipos text[] DEFAULT NULL::text[], p_fornecedor text DEFAULT NULL::text, p_cfops text[] DEFAULT NULL::text[], p_produto text DEFAULT NULL::text, p_local bigint DEFAULT NULL::bigint, p_status text DEFAULT 'CONCLUIDA'::text, p_bonificacao boolean DEFAULT false)
 RETURNS TABLE(data date, mes text, nota text, fornecedor text, tipo text, familia text, produto text, codigo text, ncm text, cfop text, unidade text, qtde numeric, preco_unit numeric, total numeric, valor_estoque numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    nf.d_emissao_nfe as data,
    to_char(nf.d_emissao_nfe, 'YYYY-MM') as mes,
    nf.c_numero_nfe as nota,
    coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
    p.tipo_item as tipo,
    p.descricao_familia as familia,
    i.c_descricao_produto as produto,
    i.c_codigo_produto as codigo,
    i.c_ncm as ncm,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop,
    i.c_unidade_nfe as unidade,
    coalesce(i.n_qtde_nfe, 0)::numeric as qtde,
    coalesce(i.n_preco_unit, 0)::numeric as preco_unit,
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as total,
    custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) as valor_estoque
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and item_movimenta_estoque(i.full_object)
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and (p_bonificacao or right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908'))
  order by nf.d_emissao_nfe desc, total desc, i.id;
$function$;

grant execute on function public.relatorio_compras_total(bigint, date, date, text[], text[], text, text[], text, bigint, text, boolean) to authenticated, service_role;
grant execute on function public.relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[], text, bigint, text, boolean) to authenticated, service_role;
grant execute on function public.relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[], text, bigint, text, boolean) to authenticated, service_role;
grant execute on function public.relatorio_compras_detalhe(bigint, date, date, text[], text[], text, text[], text, bigint, text, boolean) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
