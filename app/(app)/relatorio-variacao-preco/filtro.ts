import { lerPeriodo } from '@/lib/faturamento-periodo'

// Filtros da tela, lidos igual na página e no Excel.
export type SpVariacao = { ini?: string; fim?: string; mes?: string; ver?: string }

export function lerFiltroVariacao(sp: SpVariacao, hoje: string) {
  const p = lerPeriodo(sp, hoje, 366)
  const ver = sp.ver === 'subiu' || sp.ver === 'caiu' ? sp.ver : null
  return { p, ver }
}
