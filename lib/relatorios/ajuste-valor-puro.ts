// Valor em R$ de um ajuste de estoque (tabela movimentos) na Movimentação "Por operação", modo automático.
// Puro, sem imports: node --test lib/relatorios/ajuste-valor-puro.test.ts
//
// Achado (produção, loja 5, 23/10/2026): `movimentos.valor` é o custo UNITÁRIO do ajuste (igual ao valor_unit do
// kardex do Omie), não o total. A matriz somava o unitário como se fosse o valor da linha (out/2026: 25 saídas por
// inventário somavam R$ 719.099,73 de unitários). E a contagem de inventário (tipo SLD) guarda o SALDO CONTADO, não o
// que entrou ou saiu: somar a contagem como saída é errado (ver lib/movimentacao-manual.ts).
// Regra: SLD fica fora do R$; o resto vale |quantidade| × custo unitário; custo unitário acima do limite do produto
// (custo_referencia_produto, migration 290: 10 × o custo normal ou o teto do que não existe num restaurante) vale o
// custo normal (0 sem custo confiável) e a linha é marcada para o aviso.

export type RefCusto = { referencia: number | null; limite: number | null }
export type ValorAjuste = { incluir: boolean; qtde: number; valor: number; valorOmie: number; foraDoNormal: boolean }

const r2 = (n: number) => Math.round(n * 100) / 100

export function valorDoAjuste(a: { tipo: string; quan: number | string | null; valor: number | string | null }, ref?: RefCusto | null): ValorAjuste {
  if (a.tipo === 'SLD') return { incluir: false, qtde: 0, valor: 0, valorOmie: 0, foraDoNormal: false }
  const qtde = Math.abs(Number(a.quan) || 0)
  const unit = Number(a.valor) || 0
  const valorOmie = r2(qtde * unit)
  const foraDoNormal = !!ref && ref.limite != null && unit > ref.limite
  const valor = foraDoNormal ? r2(qtde * (ref!.referencia ?? 0)) : valorOmie
  return { incluir: true, qtde, valor, valorOmie, foraDoNormal }
}
