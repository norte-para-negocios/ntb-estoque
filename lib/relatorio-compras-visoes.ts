// Relatorio de Compras no layout das Notas Fiscais (puro): transforma as linhas
// rotulo x mes das RPCs relatorio_compras_* (+ complemento frio) no ranking e na
// matriz mensal que os componentes do Faturamento desenham.
// Sem alias '@/' e sem import de valor: roda direto no `node --test`.
import type { LinhaRanking, MatrizMensal } from './faturamento-itens'
import type { TipoValorCompra } from './compras/custo-estoque-item'

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
export type LinhaMesCompraDupla = LinhaMesCompra & { valor_estoque: number }

/** 'estoque' (padrão, como no Omie) usa o valor que entrou no estoque; 'fiscal' usa quantidade × preço da nota. */
export function comTipoValor(linhas: LinhaMesCompraDupla[], tipo: TipoValorCompra): LinhaMesCompra[] {
  return linhas.map((l) => ({ rotulo: l.rotulo, mes: l.mes, valor: tipo === 'estoque' ? Number(l.valor_estoque) || 0 : Number(l.valor) || 0 }))
}

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

// ---- Bonificação (paridade numérica com o Omie, 20/10/2026, bug B2) ----
// O Omie põe a bonificação (CFOP de entrada x.910) no estoque COM valor (loja 5, out/2026: 2 itens, 5.743,24 de valor de
// estoque). No NTB ela entra só em "Valor de estoque" (como o Omie, com a linha "Bonificação" à vista); em "Valor da
// nota" fica fora, como sempre (compra paga). Comodato (x.908) anda junto, como nas RPCs desde a 065.

/** CFOP de entrada de bonificação/doação/brinde (x.910) ou comodato (x.908): mesma regra das RPCs relatorio_compras_*. */
export function ehBonificacaoCfop(cfopEntrada: string | null | undefined): boolean {
  const d = (cfopEntrada ?? '').replace(/\D/g, '').slice(-3)
  return d === '910' || d === '908'
}

/** A tela de Compras pede as RPCs com p_bonificacao = true só em "Valor de estoque". */
export const incluiBonificacao = (tipo: TipoValorCompra): boolean => tipo === 'estoque'

export type TotaisCompra = { valor: number; valorEstoque: number; valorBonificacao: number; valorEstoqueBonificacao: number }

/** Linha "Bonificação" do resumo: quanto do total escolhido é bonificação (null quando não entra ou é zero). */
export function linhaBonificacao(tipo: TipoValorCompra, t: TotaisCompra): { valor: number; pct: number; semBonificacao: number } | null {
  if (!incluiBonificacao(tipo)) return null
  const v = Number(t.valorEstoqueBonificacao) || 0
  if (Math.abs(v) < 0.005) return null
  const total = Number(t.valorEstoque) || 0
  return { valor: v, pct: total ? (v / total) * 100 : 0, semBonificacao: total - v }
}
