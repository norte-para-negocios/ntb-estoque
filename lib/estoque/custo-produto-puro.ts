// Custo do produto ("nosso Omie" Fase 2, página do produto): série do custo médio, entradas que formaram o custo
// e custo do prato pela ficha. Puro, sem imports: node --test lib/estoque/custo-produto-puro.test.ts.

export type MovCusto = {
  data: string; ordem: number; local: number; quantidade: number; valorUnit: number | null; cmc: number | null
  saldo: number | null; cancelado?: boolean; doc?: string | null; origem?: string | null
}
export type PontoCusto = { data: string; cmc: number }

const ordenar = (movs: MovCusto[]) => [...movs].sort((a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem)

/** Por local: o último custo médio > 0 de cada dia, em ordem de data (movimentos cancelados fora). */
export function serieCustoMedio(movs: MovCusto[]): Map<number, PontoCusto[]> {
  const r = new Map<number, PontoCusto[]>()
  for (const m of ordenar(movs)) {
    if (m.cancelado || !(m.cmc != null && m.cmc > 0)) continue
    const arr = r.get(m.local) ?? []
    if (arr.length && arr[arr.length - 1].data === m.data) arr[arr.length - 1] = { data: m.data, cmc: m.cmc }
    else arr.push({ data: m.data, cmc: m.cmc })
    r.set(m.local, arr)
  }
  return r
}

/**
 * Entradas com custo (quantidade > 0, custo unit. > 0, não canceladas) feitas depois da última vez que o saldo do
 * local ficou <= 0 (quando o saldo zera, o custo médio recomeça das entradas seguintes). Mais recentes primeiro.
 */
export function entradasQueFormaramCusto(movs: MovCusto[], limite = 20): MovCusto[] {
  const porLocal = new Map<number, MovCusto[]>()
  for (const m of ordenar(movs)) {
    if (m.cancelado) continue
    let arr = porLocal.get(m.local) ?? []
    if (m.quantidade > 0 && (m.valorUnit ?? 0) > 0) arr.push(m)
    if (m.saldo != null && m.saldo <= 0) arr = []
    porLocal.set(m.local, arr)
  }
  return [...porLocal.values()].flat()
    .sort((a, b) => b.data.localeCompare(a.data) || b.ordem - a.ordem)
    .slice(0, limite)
}

export type ItemCusto = { insumo: number; qtdPorUnidade: number; cmc: number | null }

/** Custo de 1 unidade do prato: soma de quantidade do insumo por unidade × custo médio atual. Sem custo conta 0. */
export function custoDoPrato(itens: ItemCusto[]): { total: number; semCusto: number[]; linhas: (ItemCusto & { custo: number })[] } {
  const linhas = itens.map((i) => ({ ...i, custo: i.cmc != null && i.cmc > 0 ? i.qtdPorUnidade * i.cmc : 0 }))
  return {
    total: Math.round(linhas.reduce((a, l) => a + l.custo, 0) * 1e6) / 1e6,
    semCusto: itens.filter((i) => !(i.cmc != null && i.cmc > 0)).map((i) => i.insumo),
    linhas,
  }
}
