// Trilha de drill-down nos relatórios: ?drill=dim:rotulo|dim:rotulo
// (cada parte URL-encoded individualmente, porque rotulos têm | : e acentos).
// Sentinela '__sem__' no rotulo = "valor nulo" (Sem classificação).
export type ParDrill = { dim: string; rotulo: string }

export const SEM = '__sem__'

export function parseDrill(valor?: string): ParDrill[] {
  if (!valor) return []
  return valor
    .split('|')
    .map((parte) => {
      const i = parte.indexOf(':')
      if (i < 1) return null
      return { dim: parte.slice(0, i), rotulo: decodeURIComponent(parte.slice(i + 1)) }
    })
    .filter((p): p is ParDrill => p !== null)
}

export function serializeDrill(pares: ParDrill[]): string {
  return pares.map((p) => `${p.dim}:${encodeURIComponent(p.rotulo)}`).join('|')
}

// Monta o href preservando os searchParams atuais (exceto o próprio drill e a
// paginação) e aplicando a trilha nova. pares=[] remove o drill (voltar ao topo).
export function hrefComDrill(
  basePath: string,
  spAtual: Record<string, string | undefined>,
  pares: ParDrill[],
): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(spAtual)) {
    if (k === 'drill' || k === 'page' || !v) continue
    qs.set(k, v)
  }
  if (pares.length) qs.set('drill', serializeDrill(pares))
  const s = qs.toString()
  return `${basePath}${s ? `?${s}` : ''}`
}
