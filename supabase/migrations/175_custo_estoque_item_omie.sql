-- 175: valor de estoque de um item de nota recebida na regra do Omie (Fase A, Task 4; plano
-- docs/superpowers/plans/2026-10-18-fase-a-correcoes-provadas.md). Mesma regra de lib/compras/custo-estoque-item.ts:
-- o vTotalItem do Omie já vem sem o desconto e já contém IPI, ICMS-ST e as despesas do item; as marcações
-- "é custo de estoque" (itensCustoEstoque, ausente = 'N') tiram o que não entra. Correção da N3 de 18/10: o desconto
-- NÃO é tirado de novo (99,3 % dos pares nota × produto da loja 5 batem com o kardex do Omie).
-- Sem itensCustoEstoque ou sem vTotalItem: valor fiscal (quantidade × preço). Só funções, sem tabela nem índice.

create or replace function custo_estoque_item_omie(p_fo jsonb, p_qtde numeric, p_preco numeric)
returns numeric language sql immutable parallel safe as $$
  with v as (
    select coalesce(p_qtde, 0) * coalesce(p_preco, 0) as fiscal,
           nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric as t,
           coalesce(nullif(p_fo->'itensCabec'->>'vDesconto', '')::numeric, 0) as descnt,
           coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0) as ipi,
           coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0) as st,
           coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0) as icms,
           p_fo->'itensCustoEstoque' as f
  ), d as (
    select v.*, greatest(0, round(t - (fiscal - descnt) - ipi - st, 2)) as despesas from v
  )
  select case when f is null or jsonb_typeof(f) <> 'object' or t is null then round(fiscal, 2)
    else round(t
      - case when coalesce(f->>'cIPICusto', 'N') = 'N' then ipi else 0 end
      - case when coalesce(f->>'cICMSSTCusto', 'N') = 'N' then st else 0 end
      - case when coalesce(f->>'cICMSCusto', 'N') = 'N' then icms else 0 end
      - case when coalesce(f->>'cPISCusto', 'N') = 'N' then t * coalesce(nullif(f->>'nAliqCredPISCusto', '')::numeric, 0) / 100 else 0 end
      - case when coalesce(f->>'cCOFINSCusto', 'N') = 'N' then t * coalesce(nullif(f->>'nAliqCredCOFINSCusto', '')::numeric, 0) / 100 else 0 end
      - case when coalesce(f->>'cOutrosDespCusto', 'N') = 'N' then despesas else 0 end, 2)
  end from d
$$;

-- Item que o Omie não lança no estoque ("não movimenta estoque" ou "ignorar item"); "não gera conta a pagar" entra.
create or replace function item_movimenta_estoque(p_fo jsonb)
returns boolean language sql immutable parallel safe as $$
  select coalesce(p_fo->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') <> 'S'
     and coalesce(p_fo->'itensCabec'->>'cIgnorarItem', 'N') <> 'S'
$$;

grant execute on function custo_estoque_item_omie(jsonb, numeric, numeric) to authenticated, service_role;
grant execute on function item_movimenta_estoque(jsonb) to authenticated, service_role;
