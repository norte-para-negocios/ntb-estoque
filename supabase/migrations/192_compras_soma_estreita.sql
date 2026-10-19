-- 192: Fase I — Compras e valor de estoque mais rápidos, mesma saída.
--
-- Medido em produção em 19/10/2026 (usuário comum da loja 5, ano corrente, situação Concluída):
--   relatorio_compras_total 3,0–3,5 s; relatorio_compras_matriz (família, com valor_estoque como a tela pede) 3,0 s;
--   a tela de Compras chama 5 dessas RPCs em paralelo.
-- Causa principal: custo_estoque_item_omie (migration 175/185) é uma função SQL com CTEs, que o Postgres NÃO
--   consegue embutir na consulta: vira uma chamada de função por item (85 µs cada em produção; 20 mil itens da
--   loja 5 = 1,7 s só nisso). Reescrita como UMA expressão (mesmas contas, CTEs expandidas), o Postgres a embute:
--   1,71 s -> 0,75 s na soma dos 20.432 itens da loja 5 em produção, e 0 diferenças em TODOS os 69.232 itens de
--   produção (201 com bloco sefaz), conferido só leitura em 19/10.
-- Causa secundária: count(distinct) / group by ordenavam as linhas carregando o full_object inteiro (~1,4 KB):
--   "Sort Method: external merge Disk: 16552kB". As RPCs calculam os valores de cada item numa subconsulta com
--   OFFSET 0 (o Postgres não a desfaz) e só ordenam os campos estreitos. WHERE, joins, rótulos e somas iguais à 176
--   (texto copiado de pg_get_functiondef de produção; md5 igual ao do repositório). relatorio_compras_detalhe não
--   muda (não agrega). Prova de igualdade e tempos: scripts/testes-sql/192_compras_soma_estreita.sql.
--
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 192_compras_soma_estreita.sql
-- Reverter: (a) as três RPCs: reaplicar como estão em supabase/migrations/176_compras_valor_estoque.sql
--   (relatorio_compras_total, relatorio_compras_dim, relatorio_compras_matriz; mesma assinatura);
--   (b) custo_estoque_item_omie: rodar o bloco ORIGINAL abaixo (produção, 19/10/2026).
-- Se as RPCs mudarem de REGRA, replicar em lib/relatorio-frio-nf.ts (AGENTS.md) — esta migration não muda regra.
-- custo_estoque_item_omie também é usada por lancar_compra (185) e pelo Excel/relatório mensal: mesma saída.
/* ORIGINAL de produção (19/10/2026):
CREATE OR REPLACE FUNCTION public.custo_estoque_item_omie(p_fo jsonb, p_qtde numeric, p_preco numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  with v as (
    select coalesce(p_qtde, 0) * coalesce(p_preco, 0) as fiscal,
           nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric as t,
           coalesce(nullif(p_fo->'itensCabec'->>'vDesconto', '')::numeric, 0) as descnt,
           coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0) as ipi,
           coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0) as st,
           coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0) as icms,
           p_fo->'itensCustoEstoque' as f,
           case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end as s
  ), d as (
    select v.*, greatest(0, round(t - (fiscal - descnt) - ipi - st, 2)) as despesas,
           coalesce(nullif(s->>'vFrete', '')::numeric, 0) as vfrete,
           coalesce(nullif(s->>'vSeg', '')::numeric, 0) as vseg,
           coalesce(nullif(s->>'freteCte', '')::numeric, 0) as cte
      from v
  ), b as (
    select d.*, t
      - case when coalesce(f->>'cIPICusto', 'N') = 'N' then ipi else 0 end
      - case when coalesce(f->>'cICMSSTCusto', 'N') = 'N' then st else 0 end
      - case when coalesce(f->>'cICMSCusto', 'N') = 'N' then icms else 0 end
      - case when coalesce(f->>'cPISCusto', 'N') = 'N' then t * coalesce(nullif(f->>'nAliqCredPISCusto', '')::numeric, 0) / 100 else 0 end
      - case when coalesce(f->>'cCOFINSCusto', 'N') = 'N' then t * coalesce(nullif(f->>'nAliqCredCOFINSCusto', '')::numeric, 0) / 100 else 0 end as base
      from d
  )
  select case when f is null or jsonb_typeof(f) <> 'object' or t is null then round(fiscal, 2)
    when s is null then round(base - case when coalesce(f->>'cOutrosDespCusto', 'N') = 'N' then despesas else 0 end, 2)
    else round(base
      - case when coalesce(f->>'cFreteCusto', 'N') = 'N' then vfrete else 0 end
      - case when coalesce(f->>'cSeguroCusto', 'N') = 'N' then vseg else 0 end
      - case when coalesce(f->>'cOutrosDespCusto', 'N') = 'N' then greatest(0, round(despesas - vfrete - vseg, 2)) else 0 end
      + case when coalesce(f->>'cFreteCusto', 'N') = 'N' then 0 else cte end, 2)
  end from b
$function$;
*/

begin;

-- custo de estoque do item, em uma expressão só (embutível pelo planner)
create or replace function public.custo_estoque_item_omie(p_fo jsonb, p_qtde numeric, p_preco numeric)
 returns numeric
 language sql
 immutable parallel safe
as $function$
  select case when (p_fo->'itensCustoEstoque') is null or jsonb_typeof((p_fo->'itensCustoEstoque')) <> 'object' or (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) is null then round((coalesce(p_qtde, 0) * coalesce(p_preco, 0)), 2)
    when (case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end) is null then round(((nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric)
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cIPICusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cICMSSTCusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cICMSCusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cPISCusto', 'N') = 'N' then (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) * coalesce(nullif((p_fo->'itensCustoEstoque')->>'nAliqCredPISCusto', '')::numeric, 0) / 100 else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cCOFINSCusto', 'N') = 'N' then (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) * coalesce(nullif((p_fo->'itensCustoEstoque')->>'nAliqCredCOFINSCusto', '')::numeric, 0) / 100 else 0 end)
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cOutrosDespCusto', 'N') = 'N' then (greatest(0, round((nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) - ((coalesce(p_qtde, 0) * coalesce(p_preco, 0)) - (coalesce(nullif(p_fo->'itensCabec'->>'vDesconto', '')::numeric, 0))) - (coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0)) - (coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0)), 2))) else 0 end, 2)
    else round(((nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric)
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cIPICusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cICMSSTCusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cICMSCusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cPISCusto', 'N') = 'N' then (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) * coalesce(nullif((p_fo->'itensCustoEstoque')->>'nAliqCredPISCusto', '')::numeric, 0) / 100 else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cCOFINSCusto', 'N') = 'N' then (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) * coalesce(nullif((p_fo->'itensCustoEstoque')->>'nAliqCredCOFINSCusto', '')::numeric, 0) / 100 else 0 end)
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cFreteCusto', 'N') = 'N' then (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'vFrete', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cSeguroCusto', 'N') = 'N' then (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'vSeg', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cOutrosDespCusto', 'N') = 'N' then greatest(0, round((greatest(0, round((nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) - ((coalesce(p_qtde, 0) * coalesce(p_preco, 0)) - (coalesce(nullif(p_fo->'itensCabec'->>'vDesconto', '')::numeric, 0))) - (coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0)) - (coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0)), 2))) - (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'vFrete', '')::numeric, 0)) - (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'vSeg', '')::numeric, 0)), 2)) else 0 end
      + case when coalesce((p_fo->'itensCustoEstoque')->>'cFreteCusto', 'N') = 'N' then 0 else (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'freteCte', '')::numeric, 0)) end, 2)
  end
$function$;

create or replace function public.relatorio_compras_total(p_loja_id bigint, p_ini date, p_fim date, p_familias text[] default null::text[], p_tipos text[] default null::text[], p_fornecedor text default null::text, p_cfops text[] default null::text[], p_produto text default null::text, p_local bigint default null::bigint, p_status text default 'CONCLUIDA'::text)
 returns table(valor numeric, n_notas bigint, valor_estoque numeric)
 language sql
 stable
as $function$
  select
    coalesce(sum(x.fiscal), 0)::numeric,
    count(distinct x.nf_id)::bigint,
    coalesce(sum(x.estoque), 0)::numeric
  from (
    select nf.id as nf_id,
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
      and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
    offset 0
  ) x;
$function$;

create or replace function public.relatorio_compras_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[] default null::text[], p_tipos text[] default null::text[], p_fornecedor text default null::text, p_cfops text[] default null::text[], p_produto text default null::text, p_local bigint default null::bigint, p_status text default 'CONCLUIDA'::text)
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
      and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
    offset 0
  ) x
  group by 1, 2
  order by 1, 2;
$function$;

create or replace function public.relatorio_compras_dim(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[] default null::text[], p_tipos text[] default null::text[], p_fornecedor text default null::text, p_cfops text[] default null::text[], p_produto text default null::text, p_local bigint default null::bigint, p_status text default 'CONCLUIDA'::text)
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
      and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
    offset 0
  ) x
  group by 1
  order by valor desc;
$function$;

commit;

notify pgrst, 'reload schema';
