// Pareia as linhas que uma ação criou no banco local (ids provisórios) com as que a mesma ação
// criou no servidor quando foi reenviada. Mesma ação, mesmo código: as inserções acontecem na
// mesma ordem por tabela. Se a quantidade por tabela não bate, a tabela fica sem mapa (as ações
// que dependem dela falham com explicação em vez de usar um id chutado).
export type LinhaCriada = { tabela: string; pk: Record<string, unknown> }

function idUnico(pk: Record<string, unknown>): number | null {
  const vals = Object.values(pk)
  if (vals.length !== 1) return null
  const n = Number(vals[0])
  return Number.isSafeInteger(n) ? n : null
}

export function parear(locais: LinhaCriada[], remotos: LinhaCriada[]): { mapa: Map<number, number>; divergentes: string[] } {
  const porTabela = (ls: LinhaCriada[]) => {
    const m = new Map<string, LinhaCriada[]>()
    for (const l of ls) m.set(l.tabela, [...(m.get(l.tabela) ?? []), l])
    return m
  }
  const loc = porTabela(locais)
  const rem = porTabela(remotos)
  const mapa = new Map<number, number>()
  const divergentes: string[] = []
  for (const [tabela, ls] of loc) {
    const rs = rem.get(tabela) ?? []
    if (rs.length !== ls.length) {
      divergentes.push(tabela)
      continue
    }
    ls.forEach((l, i) => {
      const a = idUnico(l.pk)
      const b = idUnico(rs[i].pk)
      if (a !== null && b !== null) mapa.set(a, b)
    })
  }
  return { mapa, divergentes: divergentes.sort() }
}
