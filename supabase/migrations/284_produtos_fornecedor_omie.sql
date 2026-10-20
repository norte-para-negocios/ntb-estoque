-- 284: Paridade numérica com o Omie (bug B8 de omie-rea/gaps/paridade-numerica-2026-10-20.md) — Produtos por
-- fornecedor: total e custo da última compra como o Omie (ERP_PRD_FOR_FORNECEDOR).
--
-- Investigado contra a captura do Omie de 17/10/2026 (loja 5, 5.817 linhas; 1.450 pares produto × fornecedor com última
-- compra ≥ 07/2025; 1.415 achados pelo NTB), só leitura:
--   * "Preço Total da Última Compra" = vTotalItem do item (2.367 de 2.368 linhas de 1 item), não quantidade × preço:
--     antes 1.225 pares iguais, agora 1.398.
--   * "Custo do Item na Última Compra" é um valor só por produto na nota = o item de MENOR sequência daquele produto
--     (o Omie repete esse custo nas linhas de cada código do fornecedor): antes 1.341, agora 1.362.
--   * Item escolhido para quantidade/preço: o de maior id (= maior sequência) continua o melhor (1.398 pares iguais; menor
--     sequência daria 1.348). O Omie faz uma linha por CÓDIGO DO FORNECEDOR (cProd do XML; ex. 60145 NF 33198 tem duas
--     linhas, 2 × 9,90 e 3 × 53,00), e esse código não vem no ListarRecebimentos — o NTB não tem como separar. A
--     função passa a devolver `itens_ultima_nota` (itens do mesmo produto nessa nota) e a tela avisa quando há mais de 1.
--   * Data: `infoCadastro.dRec` continua sendo o campo do Omie (95,9 % das linhas; dRegistro 41,8 %, dAlt 46,5 %). As
--     diferenças de data são notas re-concluídas no Omie que o NTB não releu (bug B7: 42 dos 91 pares têm aviso
--     "RecebimentoProduto.Concluido" posterior à última gravação da nota; os demais são de antes do histórico de avisos).
-- Mesma assinatura e retorno (jsonb): CREATE OR REPLACE. Loja própria não muda (custo = custo_unitario_base do item).
--
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 284_produtos_fornecedor_omie.sql
-- Reverter: reaplicar 210_relatorio_produtos_fornecedor.sql.
-- Teste: scripts/testes-sql/284_produtos_fornecedor_omie.sql (banco local).

begin;

create or replace function public.relatorio_produtos_fornecedor(p_loja_id bigint)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with modo as (select coalesce((select l.modo_estoque from lojas l where l.id = p_loja_id), 'omie') as m),
  notas as materialized (  -- materializada: o JSON da nota é lido uma vez por nota, não por item
    select n.id as nota_id, n.c_numero_nfe as nota,
           coalesce('id:' || n.n_id_fornecedor::text, 'nome:' || upper(btrim(coalesce(nullif(btrim(n.c_razao_social), ''), n.c_nome, '')))) as chave,
           coalesce(nullif(btrim(n.c_razao_social), ''), nullif(btrim(n.c_nome), ''), 'Sem fornecedor') as nome,
           nullif(btrim(n.c_nome), '') as fantasia,
           coalesce(case when ic->>'dRec' ~ '^\d{2}/\d{2}/\d{4}$' then to_date(ic->>'dRec', 'DD/MM/YYYY') end, n.d_emissao_nfe) as dia
    from notas_fiscais n
    cross join lateral (select n.full_object->'infoCadastro' as ic) j
    where (select m from modo) <> 'proprio'
      and n.loja_id = p_loja_id and n.deleted_at is null and n.c_etapa = '60'
      and coalesce(ic->>'cCancelada', 'N') <> 'S'
  ),
  omie as (
    select i.n_id_produto as prod, nt.chave, nt.nome, nt.fantasia, nullif(btrim(i.c_codigo_produto), '') as cod_forn, nt.dia,
           nt.nota, nt.nota_id, i.id as item_id, round(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0), 2) as tot
    from notas nt
    join nota_fiscal_items i on i.loja_id = p_loja_id and i.nota_fiscal_id = nt.nota_id
    where i.n_id_produto is not null and coalesce(i.c_ignorar_item, 'N') <> 'S'
  ),
  proprio as (
    select it.codigo_produto as prod,
           coalesce('cnpj:' || md5(nullif(regexp_replace(coalesce(c.fornecedor_cnpj, ''), '\D', '', 'g'), '')),
                    'nome:' || upper(btrim(coalesce(c.fornecedor_nome, '')))) as chave,
           coalesce(nullif(btrim(c.fornecedor_nome), ''), 'Sem fornecedor') as nome, null::text as fantasia,
           nullif(btrim(it.c_prod), '') as cod_forn,
           coalesce(c.emissao, (c.lancada_em at time zone 'America/Bahia')::date, (c.created_at at time zone 'America/Bahia')::date) as dia,
           c.numero as nota, c.id as nota_id, it.id as item_id, round(it.valor_total - it.desconto, 2) as tot
    from compras_proprio c
    join compras_proprio_itens it on it.compra_id = c.id and it.loja_id = c.loja_id
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
  ),
  -- só a última compra de cada par lê o detalhe do item (quantidade recebida, unidade, custo de estoque)
  det as (
    select ult.*, agg.compras, agg.total_comprado, agg.primeira, d.q, d.un, d.bruto, d.vtot, c.vest_c, c.q_c, c.n_itens
    from ult
    join agg on agg.prod = ult.prod and agg.chave = ult.chave
    cross join lateral (
      select coalesce(nullif(nullif(i.full_object->'itensAjustes'->>'nQtdeRecebida', '')::numeric, 0), i.n_qtde_nfe) as q,
             coalesce(nullif(btrim(i.full_object->'itensAjustes'->>'cUnidade'), ''), i.c_unidade_nfe) as un,
             coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0) as bruto,
             nullif(i.full_object->'itensCabec'->>'vTotalItem', '')::numeric as vtot
      from nota_fiscal_items i where (select m from modo) <> 'proprio' and i.id = ult.item_id
      union all
      select it.quantidade * coalesce(nullif(it.fator, 0), 1), p.unidade, it.valor_total - it.desconto, null::numeric
      from compras_proprio_itens it
      left join produtos p on p.loja_id = it.loja_id and p.codigo_produto = it.codigo_produto
      where (select m from modo) = 'proprio' and it.id = ult.item_id
    ) d
    cross join lateral (
      -- custo: o item de menor sequência do produto nessa nota (Omie); itens do produto na nota
      select (array_agg(custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) order by i.n_sequencia, i.id))[1] as vest_c,
             (array_agg(coalesce(nullif(nullif(i.full_object->'itensAjustes'->>'nQtdeRecebida', '')::numeric, 0), i.n_qtde_nfe) order by i.n_sequencia, i.id))[1] as q_c,
             count(*)::int as n_itens
      from nota_fiscal_items i
      where (select m from modo) <> 'proprio' and i.loja_id = p_loja_id and i.nota_fiscal_id = ult.nota_id
        and i.n_id_produto = ult.prod and coalesce(i.c_ignorar_item, 'N') <> 'S'
      having count(*) > 0
      union all
      select coalesce(it.custo_unitario_base, 0) * it.quantidade * coalesce(nullif(it.fator, 0), 1),
             it.quantidade * coalesce(nullif(it.fator, 0), 1), 1
      from compras_proprio_itens it
      where (select m from modo) = 'proprio' and it.id = ult.item_id
    ) c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'n_cod_prod', det.prod, 'fornecedor_chave', det.chave, 'fornecedor', det.nome, 'fornecedor_fantasia', det.fantasia,
           'codigo_fornecedor', det.cod_forn, 'ultima_data', det.dia, 'ultima_nota', det.nota, 'ultima_nota_id', det.nota_id,
           'qtde', round(det.q, 6), 'unidade', det.un,
           'preco_unit', case when det.q > 0 then round(det.bruto / det.q, 6) end,
           'total', coalesce(det.vtot, det.tot),
           'custo_unit', case when det.q_c > 0 then round(det.vest_c / det.q_c, 6) end,
           'itens_ultima_nota', det.n_itens,
           'compras', det.compras, 'total_comprado', det.total_comprado, 'primeira_data', det.primeira
         ) order by det.prod, det.chave), '[]'::jsonb)
  from det
$$;


commit;

notify pgrst, 'reload schema';
