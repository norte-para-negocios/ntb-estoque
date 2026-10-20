import { omieRequest, type LojaOmie } from './client'
import { pegarTravaSync, soltarTravaSync } from './trava-sync'
import { leituraPedidosOmieLigada, resumirPedidosOmie, saldoPedidosOmie, type PedidoOmie, type PedidoOmieResumo } from '@/lib/compras/pedidos-omie-puro'
import { createServiceClient } from '@/lib/supabase/server'

// Fase C, item 3: LEITURA dos pedidos de compra do Omie (PesquisarPedCompra) para a "previsão de entradas" da sugestão
// de compra das lojas Omie. DESLIGADA por padrão: só roda com OMIE_LER_PEDIDOS_COMPRA=1 no .env do servidor.
// Nunca escreve no Omie (a gravação é o C1, lib/omie/pedido-compra-gravar.ts, atrás de OMIE_GRAVAR_PEDIDOS_COMPRA).
// C1 (20/10): também lista os pedidos em aberto do Omie (inclusive os criados direto no Omie) na tela de pedidos.
// Cuidado com o limite da chave: só pendentes e recebidos parcialmente, até 5 páginas de 50, sem "aguarde e repita"
// (semRepetir), uma leitura por loja a cada 10 min (cache em memória + trava `pedidos-compra` em sync_trava).
// Não foi rodado contra produção (19/10/2026): ligar só depois de testar na loja de teste com OK do dono.

const PAGINAS_MAX = 5
const CACHE_MS = 10 * 60_000
// Chave do cache: loja + o que foi lido ('pendentes' = sugestão; 'lista' = tela "Pedidos no Omie").
const cache = new Map<string, { em: number; pedidos: PedidoOmie[] }>()

type Resposta = { nTotalPaginas?: number; pedidos_pesquisa?: PedidoOmie[] }
type Filtro = 'pendentes' | 'lista'

// pendentes: o que ainda vai chegar (sugestão). lista: também os faturados pelo fornecedor (inteiros ou em parte), para a
// tela; recebidos/cancelados/encerrados ficam fora (seriam muitas páginas e não ajudam a comprar).
const FLAGS: Record<Filtro, Record<string, 'T' | 'F'>> = {
  pendentes: {
    lExibirPedidosPendentes: 'T', lExibirPedidosRecParciais: 'T', lExibirPedidosFaturados: 'F', lExibirPedidosRecebidos: 'F',
    lExibirPedidosCancelados: 'F', lExibirPedidosEncerrados: 'F', lExibirPedidosFatParciais: 'F',
  },
  lista: {
    lExibirPedidosPendentes: 'T', lExibirPedidosRecParciais: 'T', lExibirPedidosFaturados: 'T', lExibirPedidosRecebidos: 'F',
    lExibirPedidosCancelados: 'F', lExibirPedidosEncerrados: 'F', lExibirPedidosFatParciais: 'T',
  },
}

async function lerPedidos(loja: LojaOmie, filtro: Filtro): Promise<PedidoOmie[]> {
  const todos: PedidoOmie[] = []
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const r = await omieRequest<Resposta>({
      loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
      endpoint: 'v1/produtos/pedidocompra', call: 'PesquisarPedCompra', semRepetir: true,
      data: { nPagina: pagina, nRegsPorPagina: 50, lApenasImportadoApi: 'F', ...FLAGS[filtro] },
    })
    todos.push(...(r.pedidos_pesquisa ?? []))
    if (!r.nTotalPaginas || pagina >= r.nTotalPaginas) break
  }
  return todos
}

/**
 * Lê (com cache de 10 min e a trava `pedidos-compra`, uma leitura do método por vez na loja) ou devolve o cache.
 * Só com OMIE_LER_PEDIDOS_COMPRA=1; o chamador confere antes.
 */
async function pedidosComCache(lojaId: number, filtro: Filtro): Promise<{ pedidos: PedidoOmie[] | null; aviso: string | null; truncado: boolean }> {
  const chave = `${lojaId}:${filtro}`
  const c = cache.get(chave)
  if (c && Date.now() - c.em < CACHE_MS) return { pedidos: c.pedidos, aviso: null, truncado: false }
  if (!(await pegarTravaSync(lojaId, 'pedidos-compra', 600))) {
    return { pedidos: c?.pedidos ?? null, aviso: c ? null : 'Pedidos do Omie sendo lidos agora; recarregue em instantes.', truncado: false }
  }
  try {
    const { data: loja } = await createServiceClient({ semAutor: true }).from('lojas').select('id, omie_app_key, omie_app_secret, is_test').eq('id', lojaId).single<LojaOmie>()
    if (!loja?.omie_app_key) return { pedidos: null, aviso: 'Loja sem chave do Omie.', truncado: false }
    const pedidos = await lerPedidos(loja, filtro)
    cache.set(chave, { em: Date.now(), pedidos })
    return { pedidos, aviso: null, truncado: pedidos.length >= PAGINAS_MAX * 50 }
  } finally {
    await soltarTravaSync(lojaId, 'pedidos-compra')
  }
}

/**
 * Saldo a receber dos pedidos do Omie por produto (nCodProd), ou null quando a leitura está desligada/indisponível
 * (a tela então avisa que os pedidos do Omie não entraram na previsão de entradas).
 */
export async function saldoPedidosCompraOmie(lojaId: number, fimEstimativa: string): Promise<{ saldo: Map<number, number> | null; aviso: string | null }> {
  if (!leituraPedidosOmieLigada(process.env)) return { saldo: null, aviso: 'Pedidos de compra do Omie não são lidos (leitura desligada).' }
  try {
    const r = await pedidosComCache(lojaId, 'pendentes')
    return { saldo: r.pedidos ? saldoPedidosOmie(r.pedidos, fimEstimativa) : null, aviso: r.aviso }
  } catch (e) {
    console.error('pedidos-compra-omie: leitura falhou', e instanceof Error ? e.message : e)
    return { saldo: null, aviso: 'Não foi possível ler os pedidos de compra do Omie agora.' }
  }
}

/**
 * C1: pedidos de compra em aberto no Omie (inclusive os criados direto no Omie) para a tela de pedidos da loja Omie.
 * null = leitura desligada (OMIE_LER_PEDIDOS_COMPRA) ou loja que não é Omie: a tela nem mostra a seção.
 */
export async function listarPedidosCompraOmie(lojaId: number): Promise<{ pedidos: PedidoOmieResumo[]; aviso: string | null; truncado: boolean } | null> {
  if (!leituraPedidosOmieLigada(process.env)) return null
  try {
    const r = await pedidosComCache(lojaId, 'lista')
    if (!r.pedidos) return { pedidos: [], aviso: r.aviso ?? 'Não foi possível ler os pedidos de compra do Omie agora.', truncado: false }
    const codFor = [...new Set(r.pedidos.map((p) => Number(p.cabecalho_consulta?.nCodFor)).filter((x) => x > 0))]
    const nomes = new Map<number, string>()
    const sb = createServiceClient({ semAutor: true })
    for (let i = 0; i < codFor.length; i += 200) {
      const { data } = await sb.from('fornecedores').select('codigo_omie, razao_social, nome_fantasia').eq('loja_id', lojaId).in('codigo_omie', codFor.slice(i, i + 200))
      for (const f of data ?? []) nomes.set(Number(f.codigo_omie), (f.nome_fantasia as string) || (f.razao_social as string))
    }
    return { pedidos: resumirPedidosOmie(r.pedidos, nomes), aviso: r.aviso, truncado: r.truncado }
  } catch (e) {
    console.error('pedidos-compra-omie: lista falhou', e instanceof Error ? e.message : e)
    return { pedidos: [], aviso: 'Não foi possível ler os pedidos de compra do Omie agora.', truncado: false }
  }
}
