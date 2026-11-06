import { lerPeriodo } from '@/lib/faturamento-periodo'
import { ROTULO_CAUSA, type CausaPerda } from '@/lib/estoque/perdas-puro'

// Filtros da tela, lidos igual na página e no Excel.
export type SpPerdas = { ini?: string; fim?: string; mes?: string; causa?: string }

export const CAUSAS = Object.keys(ROTULO_CAUSA) as CausaPerda[]

export function lerFiltroPerdas(sp: SpPerdas, hoje: string) {
  const p = lerPeriodo(sp, hoje, 366)
  const causa = CAUSAS.includes(sp.causa as CausaPerda) ? (sp.causa as CausaPerda) : null
  return { p, causa }
}
