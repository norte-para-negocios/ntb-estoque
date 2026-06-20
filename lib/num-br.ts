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

// Quantidade EXATA como veio do Omie/banco: TODAS as casas decimais, sem
// arredondar e sem zeros a direita. Aceita numero ou string numerica do banco.
// Regra do fundador: se a quantidade for 0,0139203299, tem que aparecer isso —
// nunca arredondar para 3 casas. Ex.: 0.0139203299 -> "0,0139203299";
// "240.000000" -> "240"; 1.5 -> "1,5"; null -> "".
export function formatQtdExata(v: number | string | null | undefined): string {
  if (v == null || v === '') return ''
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return ''
  // Limpa o RUIDO de ponto flutuante (que nao e quantidade real, e lixo de double)
  // antes de formatar, mantendo TODAS as casas decimais reais. toPrecision(15) corta
  // so o lixo alem dos ~15 digitos significativos seguros do double: numa SOMA
  // agregada, 972015,3823829998 vira 972015,382383 (sem o "9998" de ruido); um valor
  // individual como 0,0139203299 fica intacto. Sem zeros a direita, milhar pt-BR.
  const limpo = Number(n.toPrecision(15))
  return limpo.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
}

// Total AGREGADO de quantidade (somatorio de relatorio, ex.: total de entradas do
// mes): no maximo 2 casas, limpo e gerencial. Um grande total nao precisa de
// precisao de miligrama nem do ruido de float. NAO usar para a quantidade de um
// produto especifico — essa e formatQtdExata, que preserva todas as casas reais.
export function formatQtdResumo(v: number | string | null | undefined): string {
  if (v == null || v === '') return ''
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}
