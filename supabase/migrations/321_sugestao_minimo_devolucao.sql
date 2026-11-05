-- 321 — Sugestão de compra do estoque próprio: duas correções achadas na Fase 3 (loja-laboratório 19, 05/11/2026).
-- Parte do corpo de PRODUÇÃO (pg_get_functiondef, = versão da 317); só muda:
-- 1) Estoque mínimo: lia só estoque_saldos.minimo (mínimo por local). O mínimo do cadastro do produto (produtos.estoque_minimo,
--    o que a tela Produtos grava) era ignorado: produto com mínimo e sem mínimo por local sumia da sugestão, embora a tela
--    Estoque o mostre "abaixo do mínimo". Agora vale a mesma regra da tela Estoque (app/(app)/estoque/dados.ts): se algum
--    local tem mínimo, a soma dos locais; senão, o mínimo do produto.
-- 2) Consumo médio: a devolução ao fornecedor (tipo SAI, origem DEVOLUCAO_FORNECEDOR, migration 231) contava como consumo e
--    inflava o ponto de pedido e a sugestão. Fica fora, como a transferência entre locais.
-- Prova: scripts/testes-sql/321_sugestao_minimo_devolucao.sql (begin … rollback).
-- Aplicar: node scripts/aplicar-migration.mjs supabase/migrations/321_sugestao_minimo_devolucao.sql
-- Conferir: \df sugestao_compra_proprio (1 overload; grants iguais, CREATE OR REPLACE os mantém).

CREATE OR REPLACE FUNCTION public.sugestao_compra_proprio(p_loja bigint, p_ini date, p_fim date, p_proj_ini date, p_proj_fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with prod as (
  select p.codigo_produto, p.codigo, p.descricao, p.unidade, p.tipo_item, p.descricao_familia as familia, pc.lead_time_dias as lead_time,
         p.estoque_minimo as minimo_produto   -- 321
    from produtos p left join produto_compra_param pc on pc.loja_id = p.loja_id and pc.codigo_produto = p.codigo_produto
   where p.loja_id = p_loja and not coalesce(p.inativo, false)
), cons as (
  -- saídas do período (venda, consumo de produção, ajuste para baixo); transferência entre locais não é consumo;
  -- saída estornada não conta (o estorno aponta para ela em reverses_id)
  select m.codigo_produto, sum(-m.quantidade) as s from estoque_movimentos_efetivo m -- 317: data efetiva
   where m.loja_id = p_loja and m.data_ref between p_ini and p_fim and m.tipo in ('SAI', 'PRD', 'AJU') and m.quantidade < 0
     and m.reverses_id is null and not exists (select 1 from estoque_movimentos e where e.reverses_id = m.id)
     and m.origem is distinct from 'DEVOLUCAO_FORNECEDOR'   -- 321: devolver ao fornecedor não é consumo
   group by 1
), pos as (
  -- 321: sum(minimo) fica null quando nenhum local tem mínimo (aí vale o mínimo do cadastro do produto, como na tela Estoque)
  select s.codigo_produto, sum(s.saldo) as saldo, sum(s.minimo) as minimo from estoque_saldos s where s.loja_id = p_loja group by 1
), cmc as (
  select codigo_produto, nullif(cmc, 0) as cmc from estoque_custos where loja_id = p_loja
), nfp as (
  -- nota do fornecedor já recebida no sistema e ainda não lançada no estoque ("faturado pelo fornecedor")
  select i.codigo_produto, sum(coalesce(i.quantidade_recebida, i.quantidade * i.fator)) as q
    from compras_proprio c join compras_proprio_itens i on i.compra_id = c.id
   where c.loja_id = p_loja and c.status in ('pendente', 'parcial') and not i.lancado and i.codigo_produto is not null
     and coalesce(i.movimenta_estoque, true)
   group by 1
), ped as (
  -- saldo dos pedidos aguardando/aprovados que ainda não está em nenhuma nota (o que já está em nota conta em nfp)
  select s.codigo_produto, sum(greatest(0, s.quantidade_base - s.vinculado)) as q
    from pedidos_compra_itens_situacao s join pedidos_compra pc on pc.id = s.pedido_id
   where pc.loja_id = p_loja and pc.etapa in ('aguardando_aprovacao', 'aprovado')
     and (pc.previsao_entrega is null or pc.previsao_entrega <= p_proj_fim)
   group by 1
), req as (
  -- 241: requisições abertas ou aprovadas com entrega até o fim da estimativa. A que virou pedido conta aqui enquanto o
  -- pedido é rascunho (ped só conta aguardando/aprovado); depois disso conta só em ped.
  select i.codigo_produto, sum(i.quantidade * i.fator) as q
    from requisicoes_compra r join requisicoes_compra_itens i on i.requisicao_id = r.id
    left join pedidos_compra pr on pr.id = i.pedido_id
   where r.loja_id = p_loja and (r.etapa in ('aberta', 'aprovada') or (r.etapa = 'pedido' and pr.etapa = 'rascunho'))
     and (r.sugestao_entrega is null or r.sugestao_entrega <= p_proj_fim)
   group by 1
), ops as (
  select * from _sugestao_ops_abertas(p_loja, p_proj_fim)
), opent as (
  select produto, sum(quantidade) as q from ops group by 1
), opcons as (
  select (it->>'nIdProdutoMalha')::bigint as insumo, sum(coalesce((it->>'nQtde')::numeric, 0)) as q
    from ops, jsonb_array_elements(ops.itens) it where (it->>'nIdProdutoMalha') ~ '^[0-9]+$' group by 1
), prev as (
  select * from _sugestao_previsao(p_loja, (p_proj_fim - p_proj_ini) + 1)
), ficha as (
  select codigo_produto from fichas_tecnicas where loja_id = p_loja and ativa
), ult as (
  select distinct on (i.codigo_produto) i.codigo_produto, c.fornecedor_nome, nullif(regexp_replace(coalesce(c.fornecedor_cnpj, ''), '\D', '', 'g'), '') as cnpj,
         coalesce(c.emissao, c.created_at::date) as data,
         coalesce(i.custo_unitario_base, round((i.valor_total - i.desconto) / nullif(i.quantidade * i.fator, 0), 6)) as custo
    from compras_proprio c join compras_proprio_itens i on i.compra_id = c.id
   where c.loja_id = p_loja and c.status <> 'cancelada' and i.codigo_produto is not null
   order by i.codigo_produto, coalesce(c.emissao, c.created_at::date) desc, c.id desc
), linhas as (
  select p.codigo_produto, p.codigo, p.descricao, p.unidade, p.tipo_item, p.familia,
         coalesce(c.s, 0) as consumo_total, coalesce(pos.saldo, 0) as estoque_atual, coalesce(pos.minimo, nullif(p.minimo_produto, 0), 0) as estoque_minimo,
         coalesce(p.lead_time, fcp.lead_time_dias) as lead_time,   -- 241: do produto; senão do fornecedor da última nota
         case when p.lead_time is not null then 'produto' when fcp.lead_time_dias is not null then 'fornecedor' end as lead_time_origem,
         coalesce(req.q, 0) as entrada_requisicoes,
         coalesce(nfp.q, 0) as entrada_nf, coalesce(opent.q, 0) as entrada_ops, coalesce(ped.q, 0) as entrada_pedidos,
         coalesce(opcons.q, 0) as consumo_ops, coalesce(prev.qtde, 0) as previsao_qtde, coalesce(prev.dias, 0) as previsao_dias,
         (ficha.codigo_produto is not null) as tem_ficha,
         f.id as fornecedor_id, coalesce(ult.fornecedor_nome, f.razao_social) as fornecedor_nome, ult.cnpj as fornecedor_cnpj,
         ult.custo as ultimo_custo, ult.data as ultima_compra, cmc.cmc
    from prod p
    left join cons c on c.codigo_produto = p.codigo_produto
    left join pos on pos.codigo_produto = p.codigo_produto
    left join nfp on nfp.codigo_produto = p.codigo_produto
    left join ped on ped.codigo_produto = p.codigo_produto
    left join opent on opent.produto = p.codigo_produto
    left join opcons on opcons.insumo = p.codigo_produto
    left join prev on prev.n_cod_prod = p.codigo_produto
    left join ficha on ficha.codigo_produto = p.codigo_produto
    left join ult on ult.codigo_produto = p.codigo_produto
    left join cmc on cmc.codigo_produto = p.codigo_produto
    left join lateral (select f.id, f.razao_social from fornecedores f
                        where f.loja_id = p_loja and ult.cnpj is not null and regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g') = ult.cnpj
                        order by f.id limit 1) f on true
    left join fornecedor_compra_param fcp on fcp.loja_id = p_loja and fcp.fornecedor_id = f.id
    left join req on req.codigo_produto = p.codigo_produto
)
select coalesce(jsonb_agg(to_jsonb(l) order by l.codigo_produto), '[]'::jsonb) from linhas l
 where l.consumo_total <> 0 or l.estoque_minimo <> 0 or l.estoque_atual <> 0 or l.entrada_nf <> 0 or l.entrada_ops <> 0
    or l.entrada_pedidos <> 0 or l.consumo_ops <> 0 or l.entrada_requisicoes <> 0
$function$;
