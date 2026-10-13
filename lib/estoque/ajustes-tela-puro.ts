// Ajustes de estoque (tela /estoque/ajustes, "nosso Omie" Fase 3): valor e custo fora do normal.
// Sem imports: node --test lib/estoque/ajustes-tela-puro.test.ts.

export const ROTULO_ORIGEM_AJUSTE: Record<string, string> = {
  app: 'Este app', script: 'Script', pdv: 'Venda (PDV)', api: 'Integração', omie: 'Tela do Omie',
}
export const ROTULO_TIPO_AJUSTE: Record<string, string> = {
  ENT: 'Entrada', SAI: 'Saída', SLD: 'Contagem (inventário)', TRF: 'Transferência', AJU: 'Ajuste',
}

/** Valor do ajuste em R$: |quantidade| × custo unitário. SLD guarda a quantidade CONTADA (AGENTS.md, "trap do SLD"): 0. */
export function valorDoAjuste(a: { tipo: string; quantidade: number; custoUnit: number | null }): number {
  if (a.tipo === 'SLD' || a.custoUnit == null) return 0
  return Math.abs(a.quantidade) * a.custoUnit
}

/** Custo unitário de R$ 1.000 ou mais, ou 20 vezes acima/abaixo do custo médio atual do produto. */
export function custoForaDoNormal(custoUnit: number | null, cmcAtual: number | null): 'alto' | 'vezes' | null {
  if (custoUnit == null || !(custoUnit > 0)) return null
  if (custoUnit >= 1000) return 'alto'
  if (cmcAtual != null && cmcAtual > 0 && (custoUnit >= cmcAtual * 20 || custoUnit <= cmcAtual / 20)) return 'vezes'
  return null
}
