// Diferença entre o que já está em faturamento_importado e o que a sync acabou de calcular (Fase I, 19/10/2026).
// Puro (sem `@/`): `node --test lib/omie/faturamento-diff.test.ts`.
// Chave = (dimensao, rotulo, mes), a mesma PK da tabela (loja fica de fora: o escopo é sempre uma loja).
// Valor comparado arredondado a 2 casas, exatamente como syncFaturamento grava.

export type LinhaFat = { dimensao: string; rotulo: string; mes: string; valor: number }

const chave = (l: LinhaFat) => JSON.stringify([l.dimensao, l.rotulo, l.mes])
const centavos = (v: number | string) => Math.round(Number(v) * 100)

export function diffFaturamentoImportado(
  existentes: LinhaFat[],
  novos: LinhaFat[],
): { inserir: LinhaFat[]; atualizar: LinhaFat[]; apagar: LinhaFat[] } {
  const antes = new Map(existentes.map((l) => [chave(l), l]))
  const inserir: LinhaFat[] = []
  const atualizar: LinhaFat[] = []
  const vistos = new Set<string>()
  for (const n of novos) {
    const k = chave(n)
    vistos.add(k)
    const a = antes.get(k)
    if (!a) inserir.push(n)
    else if (centavos(a.valor) !== centavos(n.valor)) atualizar.push(n)
  }
  const apagar = existentes.filter((l) => !vistos.has(chave(l)))
  return { inserir, atualizar, apagar }
}
