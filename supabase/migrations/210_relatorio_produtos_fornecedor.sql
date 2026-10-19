-- 210: Produtos por fornecedor (Fase D item 6, matriz N3). Só leitura.
--
-- O relatório do Omie (ERP_PRD_FOR_FORNECEDOR) lista, por produto × fornecedor, a última compra: data, nota,
-- quantidade, preço unitário, total e custo do item. Regras provadas contra a captura de 17/10/2026 (loja 5: 1.450 pares
-- com última compra entre 07/2025 e 17/10/2026, 1.415 achados aqui): só nota CONCLUÍDA (etapa 60) e não cancelada; a
-- mais recente pela data do recebimento (infoCadastro.dRec, senão a emissão) e depois pelo id. Resultado da função
-- contra o Omie: nota 98,0 %, quantidade 97,7 %, preço 97,5 %, custo 95,1 %, data 93,4 %. Quantidade e preço na
-- unidade de estoque (nQtdeRecebida; preço = quantidade da nota × preço ÷ quantidade recebida); custo = valor que entra
-- no estoque (custo_estoque_item_omie, migration 175/192) ÷ quantidade recebida.
--
-- Loja própria: compras lançadas (lancada/parcial, item lançado) de compras_proprio(_itens); custo = custo_unitario_base.
-- A chave do fornecedor da loja própria é o md5 do CNPJ (o CNPJ nunca sai da função).
-- security invoker: vale a RLS de quem chama. Teste: scripts/testes-sql/210_relatorio_produtos_fornecedor.sql.
-- Depende da 175 (custo_estoque_item_omie).

create or replace function public.relatorio_produtos_fornecedor(p_loja_id bigint)
returns table (
  n_cod_prod bigint, fornecedor_chave text, fornecedor text, fornecedor_fantasia text, codigo_fornecedor text,
  ultima_data date, ultima_nota text, ultima_nota_id bigint, qtde numeric, unidade text, preco_unit numeric,
  total numeric, custo_unit numeric, compras integer, total_comprado numeric, primeira_data date
)
language sql stable security invoker set search_path = public as $$
  with modo as (select coalesce((select l.modo_estoque from lojas l where l.id = p_loja_id), 'omie') as m),
  omie as (
    select i.n_id_produto as prod,
           coalesce('id:' || n.n_id_fornecedor::text, 'nome:' || upper(btrim(coalesce(nullif(btrim(n.c_razao_social), ''), n.c_nome, '')))) as chave,
           coalesce(nullif(btrim(n.c_razao_social), ''), nullif(btrim(n.c_nome), ''), 'Sem fornecedor') as nome,
           nullif(btrim(n.c_nome), '') as fantasia,
           nullif(btrim(i.c_codigo_produto), '') as cod_forn,
           coalesce(case when (n.full_object->'infoCadastro'->>'dRec') ~ '^\d{2}/\d{2}/\d{4}$'
                         then to_date(n.full_object->'infoCadastro'->>'dRec', 'DD/MM/YYYY') end, n.d_emissao_nfe) as dia,
           n.c_numero_nfe as nota, n.id as nota_id, i.id as item_id,
           coalesce(nullif(nullif(i.full_object->'itensAjustes'->>'nQtdeRecebida', '')::numeric, 0), i.n_qtde_nfe) as q,
           coalesce(nullif(btrim(i.full_object->'itensAjustes'->>'cUnidade'), ''), i.c_unidade_nfe) as un,
           coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0) as bruto,
           round(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0), 2) as tot,
           custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) as vest
    from notas_fiscais n
    join nota_fiscal_items i on i.loja_id = n.loja_id and i.nota_fiscal_id = n.id
    where (select m from modo) <> 'proprio'
      and n.loja_id = p_loja_id and n.deleted_at is null and n.c_etapa = '60'
      and coalesce(n.full_object->'infoCadastro'->>'cCancelada', 'N') <> 'S'
      and i.n_id_produto is not null and coalesce(i.c_ignorar_item, 'N') <> 'S'
  ),
  proprio as (
    select it.codigo_produto as prod,
           coalesce('cnpj:' || md5(nullif(regexp_replace(coalesce(c.fornecedor_cnpj, ''), '\D', '', 'g'), '')),
                    'nome:' || upper(btrim(coalesce(c.fornecedor_nome, '')))) as chave,
           coalesce(nullif(btrim(c.fornecedor_nome), ''), 'Sem fornecedor') as nome, null::text as fantasia,
           nullif(btrim(it.c_prod), '') as cod_forn,
           coalesce(c.emissao, (c.lancada_em at time zone 'America/Bahia')::date, (c.created_at at time zone 'America/Bahia')::date) as dia,
           c.numero as nota, c.id as nota_id, it.id as item_id,
           it.quantidade * coalesce(nullif(it.fator, 0), 1) as q, p.unidade as un,
           it.valor_total - it.desconto as bruto,
           round(it.valor_total - it.desconto, 2) as tot,
           round(coalesce(it.custo_unitario_base, 0) * it.quantidade * coalesce(nullif(it.fator, 0), 1), 2) as vest
    from compras_proprio c
    join compras_proprio_itens it on it.compra_id = c.id and it.loja_id = c.loja_id
    left join produtos p on p.loja_id = c.loja_id and p.codigo_produto = it.codigo_produto
    where (select m from modo) = 'proprio'
      and c.loja_id = p_loja_id and c.status in ('lancada', 'parcial') and it.lancado and it.codigo_produto is not null
  ),
  u as (select * from omie union all select * from proprio),
  agg as (
    select prod, chave, count(distinct nota_id)::int as compras, round(sum(tot), 2) as total_comprado, min(dia) as primeira
    from u group by prod, chave
  ),
  ult as (
    select distinct on (prod, chave) * from u order by prod, chave, dia desc nulls last, nota_id desc, item_id desc
  )
  select ult.prod, ult.chave, ult.nome, ult.fantasia, ult.cod_forn, ult.dia, ult.nota, ult.nota_id,
         round(ult.q, 6), ult.un,
         case when ult.q > 0 then round(ult.bruto / ult.q, 6) end,
         ult.tot,
         case when ult.q > 0 then round(ult.vest / ult.q, 6) end,
         agg.compras, agg.total_comprado, agg.primeira
  from ult join agg on agg.prod = ult.prod and agg.chave = ult.chave
  order by ult.prod, ult.chave
$$;

revoke all on function public.relatorio_produtos_fornecedor(bigint) from public, anon;
grant execute on function public.relatorio_produtos_fornecedor(bigint) to authenticated;
