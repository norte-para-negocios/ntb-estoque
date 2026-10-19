import { createClient } from '@/lib/supabase/server'
import { conferirPedidoNota, ordenarPedidosParaNota, type ItemNotaConf, type LinhaConf } from '@/lib/compras/pedido-puro'

// Fase C: pedido de compra ligado à nota do estoque próprio e a conferência pedido × nota × recebido (só leitura).

export type PedidoNaNota = { pedidoId: number; numero: number; fornecedor: string; etapa: string; linhas: LinhaConf[] }
export type SugestaoPedido = { id: number; numero: number; fornecedor: string; previsao: string | null; comuns: number }
export type PedidoDaNota = { vinculados: PedidoNaNota[]; sugestoes: SugestaoPedido[]; erro: string | null }

const n = (v: unknown) => Number(v ?? 0) || 0

export async function carregarPedidoDaNota(lojaId: number, compraId: number): Promise<PedidoDaNota> {
  const sb = await createClient()
  const [{ data: comp }, { data: itensRaw }, { data: vincs, error }] = await Promise.all([
    sb.from('compras_proprio').select('id, fornecedor_cnpj').eq('loja_id', lojaId).eq('id', compraId).maybeSingle(),
    sb.from('compras_proprio_itens').select('id, codigo_produto, descricao, quantidade, fator, quantidade_recebida, valor_total, desconto, lancado').eq('loja_id', lojaId).eq('compra_id', compraId).order('linha'),
    sb.from('pedidos_compra_vinculos').select('pedido_id, pedido_item_id, compra_item_id').eq('loja_id', lojaId).eq('compra_id', compraId),
  ])
  if (error) return { vinculados: [], sugestoes: [], erro: null } // migration 200 ainda não aplicada: a seção some
  const vincPorItem = new Map((vincs ?? []).map((v) => [n(v.compra_item_id), n(v.pedido_item_id)]))
  const notaItens: ItemNotaConf[] = (itensRaw ?? []).map((i) => {
    const base = n(i.quantidade) * (n(i.fator) || 1)
    return {
      id: n(i.id), codigoProduto: i.codigo_produto == null ? null : n(i.codigo_produto), descricao: i.descricao ?? '',
      quantidadeBase: base, precoBase: base > 0 ? (n(i.valor_total) - n(i.desconto)) / base : 0,
      recebido: i.quantidade_recebida == null ? base : n(i.quantidade_recebida), lancado: !!i.lancado, pedidoItemId: vincPorItem.get(n(i.id)) ?? null,
    }
  })
  const pedidoIds = [...new Set((vincs ?? []).map((v) => n(v.pedido_id)))]
  const vinculados: PedidoNaNota[] = []
  if (pedidoIds.length) {
    const [{ data: cabs }, { data: its }] = await Promise.all([
      sb.from('pedidos_compra').select('id, numero, fornecedor_nome, etapa').eq('loja_id', lojaId).in('id', pedidoIds),
      sb.from('pedidos_compra_itens_situacao').select('id, pedido_id, codigo_produto, descricao, quantidade_base, preco_base, vinculado').eq('loja_id', lojaId).in('pedido_id', pedidoIds).order('linha'),
    ])
    for (const c of cabs ?? []) {
      const doPedido = (its ?? []).filter((i) => n(i.pedido_id) === n(c.id))
      const idsItens = new Set(doPedido.map((i) => n(i.id)))
      const daNota = notaItens.filter((x) => x.pedidoItemId == null || idsItens.has(x.pedidoItemId))
      // saldo que o pedido esperava nesta nota = pedido − o que já está em outras notas
      const pedidoConf = doPedido.map((i) => {
        const nesta = notaItens.filter((x) => x.pedidoItemId === n(i.id) && x.codigoProduto === n(i.codigo_produto)).reduce((a, x) => a + x.recebido, 0)
        return { id: n(i.id), codigoProduto: n(i.codigo_produto), descricao: i.descricao, quantidadeBase: Math.max(0, n(i.quantidade_base) - (n(i.vinculado) - nesta)), precoBase: n(i.preco_base) }
      })
      vinculados.push({ pedidoId: n(c.id), numero: n(c.numero), fornecedor: c.fornecedor_nome, etapa: c.etapa, linhas: conferirPedidoNota(pedidoConf, daNota) })
    }
    return { vinculados, sugestoes: [], erro: null }
  }
  // sem vínculo: pedidos aprovados que podem ser desta nota
  const { data: abertos } = await sb.from('pedidos_compra').select('id, numero, fornecedor_nome, fornecedor_cnpj, previsao_entrega').eq('loja_id', lojaId).eq('etapa', 'aprovado').order('numero').limit(200)
  if (!abertos?.length) return { vinculados: [], sugestoes: [], erro: null }
  const { data: its } = await sb.from('pedidos_compra_itens').select('pedido_id, codigo_produto').eq('loja_id', lojaId).in('pedido_id', abertos.map((a) => n(a.id)))
  const prods = new Map<number, number[]>()
  for (const i of its ?? []) prods.set(n(i.pedido_id), [...(prods.get(n(i.pedido_id)) ?? []), n(i.codigo_produto)])
  const daNota = notaItens.map((x) => x.codigoProduto).filter((x): x is number => x != null)
  const ordenados = ordenarPedidosParaNota(abertos.map((a) => ({ id: n(a.id), numero: n(a.numero), fornecedorCnpj: a.fornecedor_cnpj, produtos: prods.get(n(a.id)) ?? [], previsao: a.previsao_entrega, fornecedor: a.fornecedor_nome })),
    { cnpj: comp?.fornecedor_cnpj ?? null, produtos: daNota })
  const set = new Set(daNota)
  return { vinculados: [], sugestoes: ordenados.slice(0, 5).map((p) => ({ id: p.id, numero: p.numero, fornecedor: p.fornecedor, previsao: p.previsao, comuns: p.produtos.filter((x) => set.has(x)).length })), erro: null }
}
