// Número DIGITADO em pt-BR (quantidade, custo, preço, mínimo). Regra única do sistema, decidida pelo dono e pelo
// Ramon em 05/11/2026: ponto é só separador de milhar e vírgula é decimal.
//   "1.500" = 1500 · "1.234,5" = 1234,5 · "1,5" = 1,5 · "1500" = 1500 · "3," = 3 (ainda digitando)
// Ponto que não pode ser milhar (casas depois do ponto ≠ 3, ou grupo que começa com 0: "3.400000", "1.5", "0.125") é
// valor de máquina com ponto decimal e segue como decimal (compatível com o que o banco e o String(numero) devolvem).
// Formato quebrado ("1,234.5", "1.23,4", "1e3") = NaN: quem chama mostra MSG_NUMERO_BR, nunca vira outro número calado.
// Vazio = null (o chamador decide se é válido).
export const MSG_NUMERO_BR = 'Número inválido: use vírgula para decimal (1,5) e ponto só para milhar (1.500).'

const RE_INTEIRO_OU_VIRGULA = /^-?(\d+,?\d*|,\d+)$/
const RE_MILHAR = /^-?[1-9]\d{0,2}(\.\d{3})+(,\d*)?$/
const RE_PONTO_DECIMAL = /^-?\d+\.\d+$/

export function parseNumBR(v: string): number | null {
  const t = String(v ?? '').replace(/[\s\u00a0]/g, '')
  if (t === '') return null
  if (RE_MILHAR.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'))
  if (RE_INTEIRO_OU_VIRGULA.test(t)) return Number(t.replace(',', '.'))
  if (RE_PONTO_DECIMAL.test(t)) return Number(t)
  return NaN
}

/** Para server actions: número passa direto; texto segue `parseNumBR`; vazio/nulo = null; inválido = NaN. */
export function lerNumeroBR(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  return parseNumBR(String(v))
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

// Custo UNITARIO em R$ (custo medio, custo da entrada, custo do insumo). Item vendido/estocado em
// unidade pequena (g, ml) custa frações de centavo: com 2 casas, R$ 0,006224/g virava "R$ 0,01" e
// escondia o valor real. Regra: >= R$ 0,10 -> 2 casas; abaixo disso, 3 algarismos significativos
// (até 6 casas). TOTAIS em R$ (saldo x custo, valor da nota) continuam com 2 casas: não usar aqui.
// Ex.: 12.5 -> "R$ 12,50"; 0.006224 -> "R$ 0,00622"; 0.01128 -> "R$ 0,0113"; com unidade "g" -> "R$ 0,00622/g".
export function formatCustoUnit(v: number | string | null | undefined, unidade?: string | null): string {
  if (v == null || v === '') return '-'
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '-'
  const abs = Math.abs(n)
  const casas = abs === 0 || abs >= 0.1 ? 2 : Math.min(6, Math.max(2, -Math.floor(Math.log10(abs)) + 2))
  const txt = n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: casas })
  return unidade ? `${txt}/${unidade.toLowerCase()}` : txt
}
