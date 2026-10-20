// Fase F [H1]: devolução ao fornecedor no estoque próprio, SEM emitir NF-e (a emissão fica para depois, com OK do
// dono e SEFAZ). Regras puras; a escrita é a função devolucao_fornecedor_registrar (migration 231).
// Sem imports: node --test lib/compras/devolucao-puro.test.ts

export type SituacaoDevolucao = 'a_emitir' | 'emitida' | 'cancelada'

const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const r2 = (n: number) => Math.round(n * 100) / 100

// CFOP de entrada → CFOP de devolução (5 dentro do estado, 6 fora; a NF-e acerta pela UF do fornecedor). Só pares com
// CFOP de devolução válido na NF-e (indDevol=1; mesma tabela de lib/nfe-saida/regras-puro.ts). Entrada sem par
// (bonificação 1.910, outras 1.949...) = '' (sem sugestão): a NF-e de devolução não sai pelo app (5.949 com finalidade 4
// é rejeição 327). Sem CFOP de entrada: 5.202.
const DEVOLUCAO: Record<string, string> = {
  '101': '201', '102': '202', '126': '210', '151': '208', '152': '209', '401': '410', '403': '411', '406': '412', '407': '413',
  '501': '503', '551': '553', '555': '555', '556': '556', '651': '660', '652': '661', '653': '662', '917': '918', '920': '921',
}

export function cfopDevolucao(cfopEntrada: string | null | undefined): string {
  const d = (cfopEntrada ?? '').replace(/\D/g, '')
  if (!d) return '5.202'
  if (!/^[123]\d{3}$/.test(d)) return ''
  const resto = DEVOLUCAO[d.slice(1)]
  if (!resto) return ''
  return `${d[0] === '1' ? '5' : '6'}.${resto}`
}

export function devolvivel(recebido: number, jaDevolvido: number): number {
  return Math.max(0, r6(recebido - jaDevolvido))
}

export type ItemPedidoDevolucao = { compraItemId: number; quantidade: number }

/** Recusa: sem motivo, sem item, quantidade zero, item de outra nota, repetido ou acima do que ainda dá para devolver. */
export function validarDevolucao(itens: ItemPedidoDevolucao[], disponiveis: Map<number, number>, motivo: string): string | null {
  if (!(motivo ?? '').trim()) return 'Informe o motivo da devolução.'
  if (!itens.length) return 'Escolha pelo menos um item para devolver.'
  const vistos = new Set<number>()
  for (const it of itens) {
    if (vistos.has(it.compraItemId)) return 'Item repetido na devolução.'
    vistos.add(it.compraItemId)
    if (!disponiveis.has(it.compraItemId)) return 'Um dos itens não é desta nota ou não entrou no estoque.'
    if (!(Number.isFinite(it.quantidade) && it.quantidade > 0)) return 'A quantidade devolvida precisa ser maior que zero.'
    if (r6(it.quantidade) > r6(disponiveis.get(it.compraItemId)!)) return `Quantidade maior do que ainda dá para devolver (${disponiveis.get(it.compraItemId)}).`
  }
  return null
}

/**
 * HIPÓTESE (sem kardex de devolução do Omie): a devolução tira as unidades ao custo da entrada original e o custo
 * médio é refeito sem elas: C₁ = (S₀·C₀ − q·c)/(S₀ − q). Saldo que zera ou fica negativo, ou resultado ≤ 0: fica C₀.
 */
export function cmcAposDevolucao(saldoTotal: number, cmc: number, quantidade: number, custoEntrada: number): number {
  const s1 = saldoTotal - quantidade
  if (s1 <= 0) return cmc
  const c1 = r6((saldoTotal * cmc - quantidade * custoEntrada) / s1)
  return c1 > 0 ? c1 : cmc
}

/** Valor fiscal do que volta (para a NF-e de devolução futura): proporcional ao valor do item na nota. */
export function valorFiscalDevolvido(valorItem: number, recebido: number, quantidade: number): number {
  if (!(recebido > 0)) return 0
  return r2((valorItem * quantidade) / recebido)
}

export function rotuloSituacaoDevolucao(s: SituacaoDevolucao | string): string {
  return s === 'a_emitir' ? 'Devolução a emitir' : s === 'emitida' ? 'NF-e emitida' : s === 'cancelada' ? 'Cancelada' : s
}
