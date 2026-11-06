import { lerPeriodo } from '@/lib/faturamento-periodo'
import type { LinhaConsumo } from '@/lib/estoque/consumo-real-puro'

// Filtros da tela, lidos igual na página e no Excel.
export type SpConsumo = { ini?: string; fim?: string; mes?: string; local?: string; ver?: string }

export function lerFiltroConsumo(sp: SpConsumo, hoje: string) {
  const p = lerPeriodo(sp, hoje, 366)
  const local = sp.local && /^\d+$/.test(sp.local) ? Number(sp.local) : null
  const ver: 'com' | 'sem' = sp.ver === 'sem' ? 'sem' : 'com'
  return { p, local, ver }
}

export function linhasDaVisao(linhas: LinhaConsumo[], ver: 'com' | 'sem'): LinhaConsumo[] {
  return linhas.filter((l) => (ver === 'sem' ? l.situacao !== 'ok' : l.situacao === 'ok'))
}
