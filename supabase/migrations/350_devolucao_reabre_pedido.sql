-- 350 — Devolução ao fornecedor reabre o saldo a receber do pedido de compra (decisão do dono e do Ramon, 05/11/2026).
-- Só estoque próprio (pedido de compra e devolução ao fornecedor só existem em loja modo_estoque='proprio'); loja Omie
-- não usa nada disto.
--
-- Antes: o item do pedido contava como recebido tudo o que entrou pelas notas vinculadas, mesmo depois de devolvido ao
-- fornecedor (231). Pedido 100% recebido com 4 de 10 devolvidos continuava "Recebido".
-- Agora: a quantidade devolvida (devolução não cancelada, em unidade de estoque, a mesma do recebido) sai de "recebido"
-- e de "vinculado". Efeitos, todos calculados a partir da view (nenhuma tabela nem etapa gravada muda):
--   * o pedido volta a "Recebido parcial" (ou "Aprovado", aguardando, se tudo foi devolvido) — etapaExibida no TS;
--   * a sugestão de compra (321) volta a contar o devolvido como "em pedido" (quantidade_base − vinculado);
--   * pc_vincular_nota escolhe de novo esse item para a próxima nota do fornecedor (saldo > 0);
--   * pc_acao 'cancelar' volta a aceitar pedido que tinha sido recebido por completo.
--   Cancelar a devolução (devolucao_fornecedor_cancelar) devolve a quantidade ao recebido: o saldo fecha de novo.
-- Pedido cancelado com algo recebido ("Encerrado") NÃO é reaberto: a etapa gravada não muda (decisão em aberto).
-- Coluna nova no fim da view: devolvido (para a tela). Colunas antigas mantêm nome, ordem e tipo.
--
-- Aplicar (com backup e OK do dono): node scripts/aplicar-migration.mjs supabase/migrations/350_devolucao_reabre_pedido.sql
-- Depois: desktop/scripts/gerar-schema.sh + versão nova do app desktop (a view vai para o banco local).
-- Teste (produção, em ROLLBACK, loja 19): bash scripts/testes-sql/350_rodar.sh  →  NOTICE "350 DEVOLUCAO REABRE PEDIDO OK"

begin;

create or replace view public.pedidos_compra_itens_situacao with (security_invoker = true) as
select i.id, i.pedido_id, i.loja_id, i.linha, i.codigo_produto, i.descricao, i.unidade, i.fator, i.quantidade, i.preco_unitario,
       i.codigo_local_estoque, i.obs,
       round(i.quantidade * i.fator, 6) as quantidade_base,
       round(i.preco_unitario / i.fator, 6) as preco_base,
       coalesce(sum(coalesce(ci.quantidade_recebida, ci.quantidade * ci.fator) - coalesce(dv.quantidade, 0))
                filter (where c.status <> 'cancelada'), 0) as vinculado,
       coalesce(sum(coalesce(ci.quantidade_recebida, ci.quantidade * ci.fator) - coalesce(dv.quantidade, 0))
                filter (where c.status <> 'cancelada' and ci.lancado), 0) as recebido,
       coalesce(sum(dv.quantidade) filter (where c.status <> 'cancelada'), 0) as devolvido
  from public.pedidos_compra_itens i
  left join public.pedidos_compra_vinculos v on v.pedido_item_id = i.id
  -- o item da nota só conta se ainda é do mesmo produto (nota corrigida depois do vínculo, vincular_item_compra, sai da conta)
  left join public.compras_proprio_itens ci on ci.id = v.compra_item_id and ci.codigo_produto = i.codigo_produto
  left join public.compras_proprio c on c.id = ci.compra_id
  -- 350: devolvido ao fornecedor (devolução não cancelada) deste item da nota, já em unidade de estoque
  left join lateral (
    select sum(di.quantidade) as quantidade
      from public.devolucoes_fornecedor_itens di
      join public.devolucoes_fornecedor d on d.id = di.devolucao_id
     where di.compra_item_id = ci.id and d.situacao <> 'cancelada'
  ) dv on true
 group by i.id;
revoke all on public.pedidos_compra_itens_situacao from anon, authenticated;
grant select on public.pedidos_compra_itens_situacao to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
