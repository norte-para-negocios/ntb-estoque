-- Estado de produção (19/10/2026) de custo_estoque_item_omie ANTES da 192 (versão da 185, com o bloco sefaz) e uma
-- cópia com outro nome (fi_custo_antigo) para o teste da 192 comparar com a nova. Só no banco local.
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

CREATE OR REPLACE FUNCTION public.fi_custo_antigo(p_fo jsonb, p_qtde numeric, p_preco numeric)
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
