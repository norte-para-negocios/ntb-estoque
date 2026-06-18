// Parse de número em pt-BR para os inputs de quantidade/mínimo (cozinha digita "1,5").
// - vazio -> null (o chamador decide se é válido)
// - com vírgula: trata como pt-BR (remove pontos de milhar, vírgula vira ponto)
// - sem vírgula: parse direto (cobre o valor programático "1.5" e inteiros)
// Retorna NaN em entrada inválida; quem chama checa Number.isNaN.
export function parseNumBR(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  return Number(norm)
}

// Number/null (ou string numerica vinda do banco, ex.: "3.400000") -> texto pt-BR
// limpo para preencher o input de quantidade, sem zeros a direita. null/invalido
// vira string vazia. Ex.: 3.4 -> "3,4"; "240.00" -> "240"; null -> "".
export function formatNumBR(v: number | string | null | undefined): string {
  if (v == null || v === '') return ''
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return ''
  // remove zeros a direita e o ponto decimal solto; troca ponto por virgula.
  return String(n).replace('.', ',')
}
