// Funcoes puras do relatorio Meta x Realizado (sem I/O, sem alias '@/').
import { addDias, type DiaValor } from './faturamento-dias.ts'

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
    diasBateram: fechados.filter((d) => d.valor >= meta).length,
    emAndamento,
  }
}
