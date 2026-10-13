// Fichas técnicas automáticas ("nosso Omie" Fase 1, cron sync-fichas): regras puras.
// Sem imports: node --test lib/estoque/fichas-puro.test.ts.

export type ItemEstruturaOmie = {
  idMalha?: number; idProdMalha: number; descrProdMalha?: string; quantProdMalha?: number; unidProdMalha?: string
  percPerdaProdMalha?: number; codigo_local_estoque?: number | null
  dIncProdMalha?: string; uIncProdMalha?: string; dAltProdMalha?: string; uAltProdMalha?: string
}

export type LinhaFicha = {
  loja_id: number; codigo_produto: number; codigo_produto_insumo: number; descricao_insumo: string | null
  quantidade: number; percentual_perda: number; unidade: string | null; tipo_insumo: string | null; id_malha: number | null
  codigo_local_estoque: number | null; local_fonte: 'ficha' | 'op' | null
  incluido_por: string | null; incluido_em: string | null; alterado_por: string | null; alterado_em: string | null
}

const dataBr = (v?: string) => { const m = (v ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
const texto = (v?: string | null) => (v && v.trim() ? v.trim() : null)

/**
 * Itens do ConsultarEstrutura → linhas de estrutura_produto_cache. O Omie não mostra o local de consumo por
 * linha na leitura (achado da faxina, 24/09); quando não vem, usa o local do insumo na última OP do produto.
 * Insumo repetido na mesma ficha: soma a quantidade (o cache tem chave única produto+insumo).
 */
export function itensDaEstrutura(
  itens: ItemEstruturaOmie[],
  ctx: { lojaId: number; codigoProduto: number; tipoPorCodigo: Map<number, string | null>; localPorInsumoOP: Map<number, number> }
): LinhaFicha[] {
  const porInsumo = new Map<number, LinhaFicha>()
  for (const it of itens) {
    const insumo = Number(it.idProdMalha)
    if (!Number.isFinite(insumo) || insumo <= 0) continue
    const anterior = porInsumo.get(insumo)
    const qtd = Number(it.quantProdMalha ?? 0)
    if (anterior) { anterior.quantidade = Math.round((anterior.quantidade + qtd) * 1e6) / 1e6; continue }
    const localFicha = it.codigo_local_estoque ? Number(it.codigo_local_estoque) : null
    const localOP = ctx.localPorInsumoOP.get(insumo) ?? null
    porInsumo.set(insumo, {
      loja_id: ctx.lojaId, codigo_produto: ctx.codigoProduto, codigo_produto_insumo: insumo,
      descricao_insumo: texto(it.descrProdMalha), quantidade: qtd, percentual_perda: Number(it.percPerdaProdMalha ?? 0),
      unidade: texto(it.unidProdMalha)?.slice(0, 10) ?? null, tipo_insumo: ctx.tipoPorCodigo.get(insumo) ?? null,
      id_malha: it.idMalha ? Number(it.idMalha) : null,
      codigo_local_estoque: localFicha ?? localOP, local_fonte: localFicha ? 'ficha' : localOP ? 'op' : null,
      incluido_por: texto(it.uIncProdMalha), incluido_em: dataBr(it.dIncProdMalha),
      alterado_por: texto(it.uAltProdMalha), alterado_em: dataBr(it.dAltProdMalha),
    })
  }
  return [...porInsumo.values()]
}

/** Nunca lidos primeiro (na ordem dada), depois os lidos há `diasRefazer` dias ou mais, mais antigos primeiro. */
export function escolherProdutosFicha(candidatos: number[], ultimaSync: Map<number, string>, agoraMs: number, limite: number, diasRefazer: number): number[] {
  const nunca = candidatos.filter((c) => !ultimaSync.has(c))
  const corte = agoraMs - diasRefazer * 86_400_000
  const vencidos = candidatos
    .filter((c) => ultimaSync.has(c) && Date.parse(ultimaSync.get(c) as string) <= corte)
    .sort((a, b) => Date.parse(ultimaSync.get(a) as string) - Date.parse(ultimaSync.get(b) as string))
  return [...nunca, ...vencidos].slice(0, limite)
}

function igual(a: unknown, b: unknown): boolean {
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null)
  const na = Number(a), nb = Number(b)
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb
  return String(a) === String(b)
}

/** Só regrava a linha da ficha se algo mudou (estrutura_produto_cache tem gatilho da outbox do desktop). */
export function fichaMudou(existente: Record<string, unknown>, nova: LinhaFicha): boolean {
  return (Object.keys(nova) as (keyof LinhaFicha)[]).some((k) => !igual(existente[k], nova[k]))
}

/** itensDetalhes de uma OP (ficha gravada nela) → insumo → local de consumo. */
export function localPorInsumoDaOP(fullObject: unknown): Map<number, number> {
  const m = new Map<number, number>()
  const itens = (fullObject as { itensDetalhes?: { nIdProdutoMalha?: number; codigo_local_estoque?: number }[] } | null)?.itensDetalhes
  for (const it of Array.isArray(itens) ? itens : []) {
    if (it?.nIdProdutoMalha && it.codigo_local_estoque) m.set(Number(it.nIdProdutoMalha), Number(it.codigo_local_estoque))
  }
  return m
}

export function insumosQueSairam(noCache: number[], naFicha: number[]): number[] {
  const novos = new Set(naFicha)
  return noCache.filter((c) => !novos.has(c))
}
