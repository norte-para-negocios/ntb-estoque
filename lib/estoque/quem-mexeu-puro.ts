// "Quem mexeu" (tela /estoque/quem-mexeu, "nosso Omie" Fase 3): linha do tempo por pessoa.
// Sem imports: node --test lib/estoque/quem-mexeu-puro.test.ts.

export type EventoTipo = 'ajuste' | 'op' | 'ficha'
/** `quando`: data (YYYY-MM-DD, dia da Bahia) ou data/hora ISO com fuso. */
export type Evento = { pessoa: string | null; quando: string; tipo: EventoTipo; titulo: string; detalhe: string; href: string | null }

const SEM_NOME = '(sem nome)'

export function chavePessoa(nome: string | null): string {
  const k = (nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  return k || SEM_NOME
}

/**
 * O sync-ajustes grava a data do Omie SEM hora ('YYYY-MM-DD' → meia-noite UTC no banco); o app grava a hora real
 * (Bahia). Meia-noite UTC exata = só data (aquele dia); qualquer outra hora = dia da Bahia (UTC-3, sem horário de verão).
 */
export function ehSoData(q: string): boolean {
  if (q.length <= 10) return true
  const t = Date.parse(q)
  return !Number.isNaN(t) && t % 86_400_000 === 0
}
export function diaDoMovimento(q: string): string {
  if (q.length <= 10) return q
  const t = Date.parse(q)
  if (Number.isNaN(t)) return q.slice(0, 10)
  return new Date(ehSoData(q) ? t : t - 3 * 3_600_000).toISOString().slice(0, 10)
}
/** Mantido por compatibilidade: dia do evento (ver diaDoMovimento). */
export const diaBahia = diaDoMovimento

/** Faixa de timestamps a pedir ao banco para os dias [ini, fim]: cobre o "só data" (00:00Z) e o dia da Bahia (até fim+1 03:00Z). Filtrar depois por diaDoMovimento. */
export function janelaDeConsulta(ini: string, fim: string): { de: string; ate: string } {
  const d = new Date(`${fim}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return { de: `${ini}T00:00:00Z`, ate: `${d.toISOString().slice(0, 10)}T03:00:00Z` }
}

/** Instante do evento para ordenar (só data = meio-dia na Bahia). */
function instante(q: string): number {
  return ehSoData(q) ? Date.parse(`${diaDoMovimento(q)}T12:00:00-03:00`) : Date.parse(q)
}

export function resumoPorPessoa(ev: Evento[]): { chave: string; nome: string; total: number; porTipo: Record<EventoTipo, number>; ultimo: string }[] {
  const m = new Map<string, { grafias: Map<string, number>; total: number; porTipo: Record<EventoTipo, number>; ultimo: string }>()
  for (const e of ev) {
    const k = chavePessoa(e.pessoa)
    const g = m.get(k) ?? { grafias: new Map(), total: 0, porTipo: { ajuste: 0, op: 0, ficha: 0 }, ultimo: e.quando }
    const grafia = e.pessoa?.trim().replace(/\s+/g, ' ') || SEM_NOME
    g.grafias.set(grafia, (g.grafias.get(grafia) ?? 0) + 1)
    g.total++
    g.porTipo[e.tipo]++
    if (instante(e.quando) > instante(g.ultimo)) g.ultimo = e.quando
    m.set(k, g)
  }
  return [...m.entries()].map(([chave, g]) => ({
    chave, nome: [...g.grafias.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    total: g.total, porTipo: g.porTipo, ultimo: g.ultimo,
  })).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'))
}

export function linhaDoTempo(ev: Evento[], chave: string | null): { dia: string; eventos: Evento[] }[] {
  const dias = new Map<string, Evento[]>()
  for (const e of ev) {
    if (chave != null && chavePessoa(e.pessoa) !== chave) continue
    const d = diaDoMovimento(e.quando)
    dias.set(d, [...(dias.get(d) ?? []), e])
  }
  return [...dias.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dia, eventos]) => ({ dia, eventos: eventos.sort((a, b) => instante(b.quando) - instante(a.quando)) }))
}
