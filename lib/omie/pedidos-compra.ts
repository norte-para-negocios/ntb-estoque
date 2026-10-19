import { omieRequest, type LojaOmie } from './client'
import { pegarTravaSync, soltarTravaSync } from './trava-sync'
import { leituraPedidosOmieLigada, saldoPedidosOmie, type PedidoOmie } from '@/lib/compras/pedidos-omie-puro'
import { createServiceClient } from '@/lib/supabase/server'

// Fase C, item 3: LEITURA dos pedidos de compra do Omie (PesquisarPedCompra) para a "previsão de entradas" da sugestão
// de compra das lojas Omie. DESLIGADA por padrão: só roda com OMIE_LER_PEDIDOS_COMPRA=1 no .env do servidor.
// Nunca escreve no Omie (gravar pedido no Omie fica para depois, com OK do dono).
// Cuidado com o limite da chave: só pendentes e recebidos parcialmente, até 5 páginas de 50, sem "aguarde e repita"
// (semRepetir), uma leitura por loja a cada 10 min (cache em memória + trava `pedidos-compra` em sync_trava).
// Não foi rodado contra produção (19/10/2026): ligar só depois de testar na loja de teste com OK do dono.

const PAGINAS_MAX = 5
const CACHE_MS = 10 * 60_000
const cache = new Map<number, { em: number; pedidos: PedidoOmie[] }>()

type Resposta = { nTotalPaginas?: number; pedidos_pesquisa?: PedidoOmie[] }

async function lerPedidos(loja: LojaOmie): Promise<PedidoOmie[]> {
  const todos: PedidoOmie[] = []
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const r = await omieRequest<Resposta>({
      loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
      endpoint: 'v1/produtos/pedidocompra', call: 'PesquisarPedCompra', semRepetir: true,
      data: {
        nPagina: pagina, nRegsPorPagina: 50, lApenasImportadoApi: 'F',
        lExibirPedidosPendentes: 'T', lExibirPedidosRecParciais: 'T', lExibirPedidosFaturados: 'F', lExibirPedidosRecebidos: 'F',
        lExibirPedidosCancelados: 'F', lExibirPedidosEncerrados: 'F', lExibirPedidosFatParciais: 'F',
      },
    })
    todos.push(...(r.pedidos_pesquisa ?? []))
    if (!r.nTotalPaginas || pagina >= r.nTotalPaginas) break
  }
  return todos
}

/**
 * Saldo a receber dos pedidos do Omie por produto (nCodProd), ou null quando a leitura está desligada/indisponível
 * (a tela então avisa que os pedidos do Omie não entraram na previsão de entradas).
 */
export async function saldoPedidosCompraOmie(lojaId: number, fimEstimativa: string): Promise<{ saldo: Map<number, number> | null; aviso: string | null }> {
  if (!leituraPedidosOmieLigada(process.env)) return { saldo: null, aviso: 'Pedidos de compra do Omie não são lidos (leitura desligada).' }
  try {
    const c = cache.get(lojaId)
    if (c && Date.now() - c.em < CACHE_MS) return { saldo: saldoPedidosOmie(c.pedidos, fimEstimativa), aviso: null }
    if (!(await pegarTravaSync(lojaId, 'pedidos-compra', 600))) {
      return { saldo: c ? saldoPedidosOmie(c.pedidos, fimEstimativa) : null, aviso: c ? null : 'Pedidos do Omie sendo lidos agora; recarregue em instantes.' }
    }
    try {
      const { data: loja } = await createServiceClient({ semAutor: true }).from('lojas').select('id, omie_app_key, omie_app_secret, is_test').eq('id', lojaId).single<LojaOmie>()
      if (!loja?.omie_app_key) return { saldo: null, aviso: 'Loja sem chave do Omie.' }
      const pedidos = await lerPedidos(loja)
      cache.set(lojaId, { em: Date.now(), pedidos })
      return { saldo: saldoPedidosOmie(pedidos, fimEstimativa), aviso: null }
    } finally {
      await soltarTravaSync(lojaId, 'pedidos-compra')
    }
  } catch (e) {
    console.error('pedidos-compra-omie: leitura falhou', e instanceof Error ? e.message : e)
    return { saldo: null, aviso: 'Não foi possível ler os pedidos de compra do Omie agora.' }
  }
}
