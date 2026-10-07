// Regras puras da tela Validade no estoque próprio (sem banco): situação do lote e janelas de vencimento.
// Datas sempre 'YYYY-MM-DD' (dia de Brasília/Bahia); comparar como texto ISO é seguro.

export type SituacaoValidade = 'vencido' | 'hoje' | 'proximo' | 'ok' | 'sem_validade'

export function somarDias(isoDia: string, dias: number): string {
  const d = new Date(`${isoDia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function diasAte(validade: string, hoje: string): number {
  const a = new Date(`${hoje}T00:00:00Z`).getTime()
  const b = new Date(`${validade}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86400000)
}

/** Situação de um lote dado o dia de hoje e o alerta (em dias) configurado na loja. */
export function situacaoValidade(validade: string | null, hoje: string, alertaDias: number): SituacaoValidade {
  if (!validade) return 'sem_validade'
  if (validade < hoje) return 'vencido'
  if (validade === hoje) return 'hoje'
  if (validade <= somarDias(hoje, Math.max(1, alertaDias))) return 'proximo'
  return 'ok'
}

export type FiltroValidade = { modo: 'vencidos' | 'periodo' | 'sem_validade' | 'todos'; dias: number }

/** Lê os parâmetros da URL com padrão seguro (dias entre 0 e 365; padrão = alerta da loja). */
export function lerFiltroValidade(sp: { modo?: string; dias?: string }, alertaDias: number): FiltroValidade {
  const modo = sp.modo === 'vencidos' || sp.modo === 'sem_validade' || sp.modo === 'todos' ? sp.modo : 'periodo'
  const n = Number(sp.dias)
  const dias = Number.isFinite(n) && n >= 0 && n <= 365 ? Math.trunc(n) : alertaDias
  return { modo, dias }
}

/** O lote entra na lista do filtro? (saldo > 0 é decidido antes, no banco) */
export function passaFiltro(validade: string | null, hoje: string, f: FiltroValidade): boolean {
  if (f.modo === 'todos') return true
  if (f.modo === 'sem_validade') return validade == null
  if (validade == null) return false
  if (f.modo === 'vencidos') return validade < hoje
  return validade >= hoje && validade <= somarDias(hoje, f.dias)
}
