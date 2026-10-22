// Contagens de inventário guardadas no aparelho até o servidor confirmar (sem imports @/,
// testável via `node --test`).
//
// Por quê (21/10/2026, loja 6, inventário 610): um deploy no meio da contagem trocou os ids
// das Server Actions. A tela aberta antes dele continuou chamando a ação velha, o servidor
// respondeu "Failed to find Server Action" e o número digitado só existia na memória da
// tela: ao sair e voltar, a contagem tinha sumido. Agora cada número vai primeiro para o
// aparelho (por loja + inventário + item) e só sai de lá quando o servidor responde.

export type Armazenamento = {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
  removeItem(chave: string): void
}

/** Número digitado (null = campo apagado) e quando foi digitado (identifica a digitação). */
export type Pendente = { quan: number | null; em: number }
export type Pendentes = Record<number, Pendente>

export const STATUS_NAO_SALVO = 'Não salvo'

export function chavePendentes(lojaId: number, inventarioId: number): string {
  return `ntb:contagem-pendente:v1:${lojaId}:${inventarioId}`
}

export function lerPendentes(st: Armazenamento, chave: string): Pendentes {
  let bruto: unknown
  try {
    bruto = JSON.parse(st.getItem(chave) ?? '{}')
  } catch {
    return {}
  }
  const out: Pendentes = {}
  if (!bruto || typeof bruto !== 'object') return out
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    const id = Number(k)
    if (!Number.isInteger(id) || !v || typeof v !== 'object') continue
    const { quan, em } = v as { quan?: unknown; em?: unknown }
    const quanOk = quan === null || (typeof quan === 'number' && Number.isFinite(quan))
    if (!quanOk || typeof em !== 'number' || !Number.isFinite(em)) continue
    out[id] = { quan: quan as number | null, em }
  }
  return out
}

function gravar(st: Armazenamento, chave: string, p: Pendentes) {
  try {
    if (Object.keys(p).length === 0) st.removeItem(chave)
    else st.setItem(chave, JSON.stringify(p))
  } catch {
    // Modo privado/armazenamento cheio: a tela segue, só sem a cópia no aparelho.
  }
}

export function guardarPendente(st: Armazenamento, chave: string, itemId: number, quan: number | null, em: number = Date.now()): Pendente {
  const p = lerPendentes(st, chave)
  p[itemId] = { quan, em }
  gravar(st, chave, p)
  return p[itemId]
}

/** O servidor respondeu a digitação `em`: apaga, a menos que já exista uma digitação mais nova. */
export function confirmarPendente(st: Armazenamento, chave: string, itemId: number, em: number) {
  const p = lerPendentes(st, chave)
  if (!p[itemId] || p[itemId].em !== em) return
  delete p[itemId]
  gravar(st, chave, p)
}

export function descartarPendentes(st: Armazenamento, chave: string, ids: number[]) {
  if (ids.length === 0) return
  const p = lerPendentes(st, chave)
  for (const id of ids) delete p[id]
  gravar(st, chave, p)
}

/**
 * Junta o que veio do servidor com o que ficou no aparelho. Pendente de item que já não
 * existe, ou cujo número o servidor já tem concluído (o envio chegou, a resposta é que se
 * perdeu), é descartado; o resto vira "Não salvo" com o número digitado, para reenviar.
 */
export function aplicarPendentes<T extends { id: number; quan: number | null; status: string | null }>(
  itens: T[],
  pendentes: Pendentes
): { itens: T[]; aplicados: number[]; descartar: number[] } {
  const porId = new Map(itens.map((i) => [i.id, i]))
  const aplicados: number[] = []
  const descartar: number[] = []
  for (const [k, p] of Object.entries(pendentes)) {
    const id = Number(k)
    const item = porId.get(id)
    const quanServidor = item?.quan == null ? null : Number(item.quan)
    if (!item || (quanServidor === p.quan && item.status === (p.quan === null ? 'Vazio' : 'Concluido'))) {
      descartar.push(id)
      continue
    }
    porId.set(id, { ...item, quan: p.quan, status: STATUS_NAO_SALVO })
    aplicados.push(id)
  }
  return { itens: itens.map((i) => porId.get(i.id)!), aplicados, descartar }
}

/**
 * A tela está com o código de antes de um deploy: o servidor não conhece mais a ação.
 * Next 16 lança `UnrecognizedActionError` ("Server Action ... was not found on the server").
 */
export function ehVersaoVelha(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { name, message } = err as { name?: unknown; message?: unknown }
  if (name === 'UnrecognizedActionError') return true
  return typeof message === 'string' && /was not found on the server|failed-to-find-server-action/i.test(message)
}

export const INTERVALO_MIN_RECARGA_MS = 60_000

/** Evita recarregar em loop se, mesmo depois de recarregar, o servidor continuar recusando. */
export function podeRecarregar(ultimaRecargaEm: number | null, agora: number): boolean {
  if (ultimaRecargaEm == null || !Number.isFinite(ultimaRecargaEm)) return true
  return agora - ultimaRecargaEm > INTERVALO_MIN_RECARGA_MS
}
