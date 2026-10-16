// Relatorio de Compras no layout das Notas Fiscais (puro): transforma as linhas
// rotulo x mes das RPCs relatorio_compras_* (+ complemento frio) no ranking e na
// matriz mensal que os componentes do Faturamento desenham.
// Sem alias '@/' e sem import de valor: roda direto no `node --test`.
import type { LinhaRanking, MatrizMensal } from './faturamento-itens'

function mesesEntre(ini: string, fim: string): string[] {
  const out: string[] = []
  let [a, m] = ini.slice(0, 7).split('-').map(Number)
  const [af, mf] = fim.slice(0, 7).split('-').map(Number)
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; a += 1 }
  }
  return out
}

export type LinhaMesCompra = { rotulo: string; mes: string; valor: number }

type Grupo = { rotulo: string; total: number; porMes: Record<string, number> }

function agrupar(linhas: LinhaMesCompra[]): Map<string, Grupo> {
  const g = new Map<string, Grupo>()
  for (const l of linhas) {
    const v = Number(l.valor) || 0
    const x = g.get(l.rotulo) ?? { rotulo: l.rotulo, total: 0, porMes: {} }
    x.porMes[l.mes] = (x.porMes[l.mes] ?? 0) + v
    x.total += v
    g.set(l.rotulo, x)
  }
  return g
}

/** Ranking por valor (maior primeiro). `chave` = rotulo cru da RPC (usado no drill); `rotulo` = nome amigavel. */
export function rankingCompras(linhas: LinhaMesCompra[], nomeDe: (raw: string) => string = (r) => r): LinhaRanking[] {
  const g = [...agrupar(linhas).values()]
  const total = g.reduce((s, x) => s + x.total, 0)
  return g
    .map((x) => ({ chave: x.rotulo, rotulo: nomeDe(x.rotulo), valor: x.total, quant: 0, cupons: 0, pct: total > 0 ? (x.total / total) * 100 : 0 }))
    .sort((a, b) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

/** Evolucao mensal: todos os meses do periodo, linhas por valor (no maximo `limite`), total e % sobre tudo. */
export function matrizCompras(linhas: LinhaMesCompra[], ini: string, fim: string, nomeDe: (raw: string) => string = (r) => r, limite = Infinity): MatrizMensal {
  const meses = mesesEntre(ini, fim)
  const g = [...agrupar(linhas).values()].sort((a, b) => b.total - a.total)
  const total = g.reduce((s, x) => s + x.total, 0)
  const totalPorMes: Record<string, number> = Object.fromEntries(meses.map((m) => [m, 0]))
  for (const x of g) for (const [m, v] of Object.entries(x.porMes)) totalPorMes[m] = (totalPorMes[m] ?? 0) + v
  return {
    meses,
    linhas: g.slice(0, limite).map((x) => ({ chave: x.rotulo, rotulo: nomeDe(x.rotulo), porMes: x.porMes, total: x.total, pct: total > 0 ? (x.total / total) * 100 : 0 })),
    totalPorMes,
    total,
  }
}
