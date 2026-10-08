// Funcoes puras (sem I/O, sem alias '@/') para o faturamento diario.
// Datas sempre 'YYYY-MM-DD'; aritmetica em UTC ao meio-dia para nao escorregar de dia.

export type DiaValor = { dia: string; valor: number }
export const MAX_DIAS = 366

const round2 = (n: number) => Math.round(n * 100) / 100

export function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function diasEntre(ini: string, fim: string): string[] {
  const out: string[] = []
  for (let d = ini; d <= fim && out.length < MAX_DIAS; d = addDias(d, 1)) out.push(d)
  return out
}

export function agruparCuponsPorDia(cupons: { data: string; valor: number; cancelado: boolean }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of cupons) {
    if (c.cancelado) continue
    const dia = String(c.data).slice(0, 10)
    m.set(dia, (m.get(dia) ?? 0) + c.valor)
  }
  for (const [k, v] of m) m.set(k, round2(v))
  return m
}

export function preencherDias(ini: string, fim: string, porDia: Map<string, number>): DiaValor[] {
  return diasEntre(ini, fim).map((dia) => ({ dia, valor: porDia.get(dia) ?? 0 }))
}

// Garante no maximo MAX_DIAS dias, preservando o trecho MAIS RECENTE (o fim).
export function limitarPeriodo(ini: string, fim: string): { ini: string; fim: string; cortado: boolean } {
  const minIni = addDias(fim, -(MAX_DIAS - 1))
  return ini < minIni ? { ini: minIni, fim, cortado: true } : { ini, fim, cortado: false }
}
