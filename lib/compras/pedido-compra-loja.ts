import { createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja, type ModoEstoque } from '@/lib/estoque/ledger'
import { leituraPedidosOmieLigada } from './pedidos-omie-puro'
import { gravacaoPedidosOmieLigada, pedidoCompraNaLoja } from './pedido-omie-gravar-puro'

export type EstadoPedidoCompraLoja = {
  modo: ModoEstoque
  /** onde o pedido do NTB existe nesta loja: 'proprio' (Fase C), 'omie' (C1, liberada) ou null (telas 404) */
  onde: 'proprio' | 'omie' | null
  /** loja Omie com a leitura dos pedidos do Omie ligada (OMIE_LER_PEDIDOS_COMPRA) */
  lerOmie: boolean
}

/**
 * Pedido de compra nesta loja (C1). Com OMIE_GRAVAR_PEDIDOS_COMPRA e OMIE_LER_PEDIDOS_COMPRA desligadas não faz consulta
 * nenhuma além do modo (a mesma de antes) e devolve o de antes: só a loja de estoque próprio tem pedido.
 */
export async function estadoPedidoCompraLoja(lojaId: number): Promise<EstadoPedidoCompraLoja> {
  const modo = await modoDaLoja(lojaId)
  const lerOmie = modo === 'omie' && leituraPedidosOmieLigada(process.env)
  if (modo !== 'omie' || !gravacaoPedidosOmieLigada(process.env)) {
    return { modo, onde: pedidoCompraNaLoja(process.env, { id: lojaId, modo, optIn: false }), lerOmie }
  }
  // Coluna da migration 270; se ela não existir (migration não aplicada), a loja fica sem opt-in.
  const { data, error } = await createServiceClient().from('lojas').select('omie_gravar_pedidos_compra').eq('id', lojaId).maybeSingle()
  if (error) console.error('pedido-compra-loja: opt-in ilegível (migration 270?)', error.message)
  const optIn = !error && (data as { omie_gravar_pedidos_compra?: boolean } | null)?.omie_gravar_pedidos_compra === true
  return { modo, onde: pedidoCompraNaLoja(process.env, { id: lojaId, modo, optIn }), lerOmie }
}
