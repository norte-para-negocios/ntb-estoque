// Utilitarios compartilhados para geracao de PDFs (relatorios).
// Centraliza formatacao de datas e moeda para evitar duplicacao entre rotas.

/** Formata string ISO "YYYY-MM-DD" ou timestamp para "DD/MM/YYYY". */
export function fmtData(d: string | null | undefined): string {
  if (!d) return '-'
  // Suporte a "YYYY-MM-DD" (corta antes do T) e timestamps completos.
  const parte = d.split('T')[0]
  const [y, m, day] = parte.split('-')
  if (!y || !m || !day) return d
  return `${day}/${m}/${y}`
}

/** Converte parametro de URL "YYYY-MM-DD" em "DD/MM/YYYY". */
export function fmtDataParam(d: string): string {
  const [y, m, day] = d.split('-')
  if (!y || !m || !day) return d
  return `${day}/${m}/${y}`
}

/** Formata numero como moeda BRL: R$ 1.234,56 */
export function moedaBR(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Formata numero como quantidade pt-BR sem zeros desnecessarios: 3.4 -> "3,4"; 5.0 -> "5".
 *  Quantidade EXATA do Omie: ate 12 casas (sem arredondar a 3), so descarta ruido de float. */
export function numBRPdf(v: number | string | null | undefined): string {
  if (v == null || v === '') return '-'
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 12 })
}

/** Formata numero como quantidade pt-BR com 2 casas: 3.4 -> "3,40" */
export function numBR2(v: number | string | null | undefined): string {
  if (v == null || v === '') return '-'
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Gera data/hora de geracao no formato "19/06/2026 14:35" (fuso Bahia). */
export function dataGeracao(): string {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Bahia',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
