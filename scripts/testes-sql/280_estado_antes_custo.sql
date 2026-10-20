-- custo_estoque_item_omie ANTES da 280 (= 192, produção em 20/10/2026). Usado por 280_custo_credito_simples.sql.
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

