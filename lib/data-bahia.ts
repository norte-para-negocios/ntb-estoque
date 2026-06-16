// Helpers de data no fuso da operacao (America/Bahia), usados por inventario e
// transferencia para datas retroativas sem escorregar de dia.

// Data escolhida (YYYY-MM-DD) -> timestamptz ao meio-dia America/Bahia, para nao
// escorregar de dia ao converter para UTC. Vazio/invalido -> undefined.
export function dataCriacaoBahia(d?: string): string | undefined {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined
  return `${d}T12:00:00-03:00`
}

// timestamptz/ISO do banco -> DD/MM/YYYY em America/Bahia (formato que o Omie
// espera no campo `data` do ajuste). Sem data, cai para hoje.
export function dataOmieBR(iso: string | null): string {
  const base = iso ? new Date(iso) : new Date()
  return base.toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

// Hoje em America/Bahia no formato YYYY-MM-DD (para defaults e comparacoes).
export function hojeBahiaISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
}
