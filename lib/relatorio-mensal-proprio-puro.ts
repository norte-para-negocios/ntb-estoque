// Relatório mensal em loja de estoque próprio: perdas e baixas de produção vêm do nosso estoque (ledger),
// não das tabelas do Omie. Funções puras, testadas em relatorio-mensal-proprio-puro.test.ts.

export type PerdaMes = { data: string; produto: number; valor: number; causa: string }
export type BaixaProducao = { codigo_produto: number; quantidade: number; custo_unitario: number | null }

/** Soma das perdas por mês (YYYY-MM), separadas em matéria-prima (tipo 01) e revenda (tipo 00). Correção de dados não é perda. */
export function perdasPorMesETipo(linhas: PerdaMes[], tipoDe: Map<number, string>): Map<string, { mp: number; revenda: number }> {
  const out = new Map<string, { mp: number; revenda: number }>()
  for (const l of linhas) {
    if (l.causa === 'correcao') continue
    const tipo = tipoDe.get(l.produto)
    if (tipo !== '01' && tipo !== '00') continue
    const mes = l.data.slice(0, 7)
    const atual = out.get(mes) ?? { mp: 0, revenda: 0 }
    if (tipo === '01') atual.mp += Math.abs(l.valor)
    else atual.revenda += Math.abs(l.valor)
    out.set(mes, atual)
  }
  return out
}

/** Consumo das ordens de produção (saídas do insumo) valorizado pelo custo de cada baixa, por produto e tipo. */
export function baixasDeProducao(movs: BaixaProducao[], tipoDe: Map<number, string>, nomeDe: Map<number, string>) {
  const revenda = new Map<string, number>()
  const materiaPrima = new Map<string, number>()
  const semCusto = new Set<number>()
  for (const m of movs) {
    if (!(m.quantidade < 0)) continue
    const tipo = tipoDe.get(m.codigo_produto)
    if (tipo !== '00' && tipo !== '01') continue
    const custo = Number(m.custo_unitario) || 0
    if (custo <= 0) { semCusto.add(m.codigo_produto); continue }
    const nome = nomeDe.get(m.codigo_produto) ?? String(m.codigo_produto)
    const alvo = tipo === '00' ? revenda : materiaPrima
    alvo.set(nome, Math.round(((alvo.get(nome) ?? 0) + -m.quantidade * custo) * 100) / 100)
  }
  return { revenda, materiaPrima, insumosSemCusto: semCusto.size }
}
