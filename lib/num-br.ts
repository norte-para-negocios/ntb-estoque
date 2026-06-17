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
