-- 280: Paridade numérica com o Omie (bug B3 de omie-rea/gaps/paridade-numerica-2026-10-20.md) — crédito de ICMS do
-- Simples Nacional sai do custo de estoque quando "ICMS é custo de estoque" = N.
--
-- Regra (PROVADA 20/10/2026 com o kardex do Omie da loja 5, só leitura): item de fornecedor do Simples (CSOSN 101/201,
-- `itensICMSSN.cSitTribSN`) não tem ICMS próprio (`itensICMS` nulo/0); o crédito permitido vem em
-- `itensICMSSN.nCredSN` (`vCredICMSSN` do XML) e o Omie o desconta do valor que entra no estoque. Antes desta migration
-- a função só lia `itensICMS.nValor`, então o crédito ficava no custo. Pares NF × produto com kardex:
--   NF 34972 / 60781: 318,00 → 305,66 (kardex 305,66);
--   NFs 4922, 4958, 4988, 5008, 5037 / 80074: 738,00 → 727,96 (615,00 → 606,64): custo unitário 0,010111 = kardex nas
--   6 casas (o kardex mostra 727,99 só porque guarda o unitário arredondado × 72.000).
--   Iguais ao kardex: set/2026 511 → 514 de 515 pares (o que sobra é a NF 3999, associação do item, bug B7);
--   out/2026 465 → 468 de 468. Nenhum outro item muda.
-- Efeito em produção (todos os itens, só leitura): loja 2 72 itens −627,30; loja 3 77 −611,19; loja 5 62 −739,39;
-- loja 6 81 −1.167,55; lojas 8, 10, 11, 13 (testes) 5 itens −28,22.
--
-- Nota própria (estoque próprio, 185 `item_compra_full_object`): a projeção já põe o crédito do Simples em
-- `itensICMS.nValor` e não grava `nCredSN`, então nada muda ali (nValor > 0 vence). Mesma regra no TypeScript:
-- `icmsDoCusto` em lib/compras/custo-estoque-item.ts (usada por entradaCustoDoItem, notas-compras-loader e
-- previaCustoItem).
--
-- Única mudança contra a 192: as duas ocorrências de
--   (coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0))
-- viraram "ICMS do custo" (crédito do Simples quando nValor = 0 e CSOSN 101/201). Continua UMA expressão (embutível).
-- Consumidores (mesma assinatura, nada a recompilar): relatorio_compras_* (192/281), relatorio_produtos_fornecedor
-- (210/284), lancar_compra (185), Excel/relatório mensal.
--
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 280_custo_credito_simples.sql
-- Reverter: reaplicar o bloco custo_estoque_item_omie de supabase/migrations/192_compras_soma_estreita.sql.
-- Teste: scripts/testes-sql/280_custo_credito_simples.sql (banco local).

begin;

create or replace function public.custo_estoque_item_omie(p_fo jsonb, p_qtde numeric, p_preco numeric)
 returns numeric
 language sql
 immutable parallel safe
as $function$
  select case when (p_fo->'itensCustoEstoque') is null or jsonb_typeof((p_fo->'itensCustoEstoque')) <> 'object' or (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) is null then round((coalesce(p_qtde, 0) * coalesce(p_preco, 0)), 2)
    when (case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end) is null then round(((nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric)
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cIPICusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cICMSSTCusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cICMSCusto', 'N') = 'N' then (case when coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0) = 0 and (p_fo->'itensICMSSN'->>'cSitTribSN') in ('101', '201') then coalesce(nullif(p_fo->'itensICMSSN'->>'nCredSN', '')::numeric, 0) else coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0) end) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cPISCusto', 'N') = 'N' then (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) * coalesce(nullif((p_fo->'itensCustoEstoque')->>'nAliqCredPISCusto', '')::numeric, 0) / 100 else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cCOFINSCusto', 'N') = 'N' then (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) * coalesce(nullif((p_fo->'itensCustoEstoque')->>'nAliqCredCOFINSCusto', '')::numeric, 0) / 100 else 0 end)
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cOutrosDespCusto', 'N') = 'N' then (greatest(0, round((nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) - ((coalesce(p_qtde, 0) * coalesce(p_preco, 0)) - (coalesce(nullif(p_fo->'itensCabec'->>'vDesconto', '')::numeric, 0))) - (coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0)) - (coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0)), 2))) else 0 end, 2)
    else round(((nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric)
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cIPICusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cICMSSTCusto', 'N') = 'N' then (coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cICMSCusto', 'N') = 'N' then (case when coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0) = 0 and (p_fo->'itensICMSSN'->>'cSitTribSN') in ('101', '201') then coalesce(nullif(p_fo->'itensICMSSN'->>'nCredSN', '')::numeric, 0) else coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0) end) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cPISCusto', 'N') = 'N' then (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) * coalesce(nullif((p_fo->'itensCustoEstoque')->>'nAliqCredPISCusto', '')::numeric, 0) / 100 else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cCOFINSCusto', 'N') = 'N' then (nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) * coalesce(nullif((p_fo->'itensCustoEstoque')->>'nAliqCredCOFINSCusto', '')::numeric, 0) / 100 else 0 end)
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cFreteCusto', 'N') = 'N' then (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'vFrete', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cSeguroCusto', 'N') = 'N' then (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'vSeg', '')::numeric, 0)) else 0 end
      - case when coalesce((p_fo->'itensCustoEstoque')->>'cOutrosDespCusto', 'N') = 'N' then greatest(0, round((greatest(0, round((nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric) - ((coalesce(p_qtde, 0) * coalesce(p_preco, 0)) - (coalesce(nullif(p_fo->'itensCabec'->>'vDesconto', '')::numeric, 0))) - (coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0)) - (coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0)), 2))) - (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'vFrete', '')::numeric, 0)) - (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'vSeg', '')::numeric, 0)), 2)) else 0 end
      + case when coalesce((p_fo->'itensCustoEstoque')->>'cFreteCusto', 'N') = 'N' then 0 else (coalesce(nullif((case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end)->>'freteCte', '')::numeric, 0)) end, 2)
  end
$function$;


commit;

notify pgrst, 'reload schema';
