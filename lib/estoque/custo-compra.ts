// Custo de entrada por unidade base. ESPELHA o cálculo de lancar_compra (migration 135): quem muda um muda o outro.
// Rateio de frete e desconto da nota proporcional ao valor líquido (vProd - vDesc) de TODOS os itens.
export type ItemCusto = { valorTotal: number; desconto: number; quantidade: number; fator: number; icms?: number }

export function totalLiquido(itens: ItemCusto[]): number {
  return itens.reduce((a, i) => a + (i.valorTotal - i.desconto), 0)
}

export function custoUnitarioBase(
  item: ItemCusto, itens: ItemCusto[], frete: number, descontoNota: number, icmsRecuperavel = false,
): number | null {
  const qtdBase = item.quantidade * item.fator
  if (!(qtdBase > 0)) return null
  const liq = item.valorTotal - item.desconto
  const total = totalLiquido(itens)
  const share = total > 0 ? liq / total : 1 / Math.max(itens.length, 1)
  const custoTotal = liq + frete * share - descontoNota * share - (icmsRecuperavel ? item.icms ?? 0 : 0)
  return Math.round((custoTotal / qtdBase) * 1e6) / 1e6
}
