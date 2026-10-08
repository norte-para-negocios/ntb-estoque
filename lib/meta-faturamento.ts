// Funcoes puras do relatorio Meta x Realizado (sem I/O, sem alias '@/').
import type { DiaValor } from './faturamento-dias'

// Local de proposito: este arquivo e testado direto no node (import com extensao .ts nao passa no tsc).
function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export type Atalho = 'hoje' | 'semana' | 'mes'

export function periodoDoAtalho(atalho: Atalho, hoje: string): { ini: string; fim: string } {
  if (atalho === 'hoje') return { ini: hoje, fim: hoje }
  if (atalho === 'mes') return { ini: `${hoje.slice(0, 8)}01`, fim: hoje }
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay() // 0=dom
  const desdeSegunda = (dow + 6) % 7
  return { ini: addDias(hoje, -desdeSegunda), fim: hoje }
}

export type ResumoMeta = {
  diasFechados: number
  realizado: number
  metaPeriodo: number
  pctAtingido: number | null
  media: number | null
  melhor: DiaValor | null
  pior: DiaValor | null
  diasBateram: number
  emAndamento: DiaValor | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function resumirMeta(dias: DiaValor[], meta: number, hoje: string): ResumoMeta {
  const fechados = dias.filter((d) => d.dia < hoje)
  const emAndamento = dias.find((d) => d.dia === hoje) ?? null
  const realizado = round2(fechados.reduce((s, d) => s + d.valor, 0))
  const metaPeriodo = round2(meta * fechados.length)
  const melhor = fechados.reduce<DiaValor | null>((m, d) => (m === null || d.valor > m.valor ? d : m), null)
  const pior = fechados.reduce<DiaValor | null>((m, d) => (m === null || d.valor < m.valor ? d : m), null)
  return {
    diasFechados: fechados.length,
    realizado,
    metaPeriodo,
    pctAtingido: metaPeriodo > 0 ? round2((realizado / metaPeriodo) * 100) : null,
    media: fechados.length ? round2(realizado / fechados.length) : null,
    melhor,
    pior,
    diasBateram: meta > 0 ? fechados.filter((d) => d.valor >= meta).length : 0,
    emAndamento,
  }
}

// Le o que a pessoa digitou no campo de meta (pt-BR, mas aceita teclado numerico com ponto decimal).
// Com virgula: virgula e' decimal e pontos sao milhar. Sem virgula: um unico ponto seguido de 1-2
// digitos e' decimal ("5000.50"); qualquer outro uso do ponto e' milhar ("5.000", "1.234.567").
export function parseValorBR(entrada: string): number {
  const t = entrada.replace(/[^\d.,]/g, '')
  if (!t) return NaN
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  if (/^\d+\.\d{1,2}$/.test(t)) return Number(t)
  return Number(t.replace(/\./g, ''))
}
