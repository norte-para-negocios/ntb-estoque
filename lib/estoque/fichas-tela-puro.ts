// Fichas técnicas (tela /estoque/fichas, "nosso Omie" Fase 3): agrupamento e "onde é usado".
// Sem imports: node --test lib/estoque/fichas-tela-puro.test.ts.

export type LinhaFichaTela = {
  produto: number; insumo: number; quantidade: number; perda: number; unidade: string | null; local: number | null
  localFonte: string | null; alteradoPor: string | null; alteradoEm: string | null; incluidoPor: string | null; incluidoEm: string | null
}
export type FichaAgrupada = { produto: number; itens: LinhaFichaTela[]; ultimaAlteracao: string | null; autor: string | null }

/** Uma ficha por produto. Autor/data = a mudança mais recente entre os itens (alteração, senão inclusão). */
export function agruparFichas(linhas: LinhaFichaTela[]): FichaAgrupada[] {
  const m = new Map<number, FichaAgrupada>()
  for (const l of linhas) {
    const f = m.get(l.produto) ?? { produto: l.produto, itens: [], ultimaAlteracao: null, autor: null }
    f.itens.push(l)
    for (const [quem, quando] of [[l.incluidoPor, l.incluidoEm], [l.alteradoPor, l.alteradoEm]] as const) {
      if (quando && (!f.ultimaAlteracao || quando > f.ultimaAlteracao)) { f.ultimaAlteracao = quando; f.autor = quem ?? null }
    }
    m.set(l.produto, f)
  }
  return [...m.values()]
}

/** Pratos cuja ficha leva o insumo. */
export function ondeEUsado(linhas: LinhaFichaTela[], insumo: number): { produto: number; quantidade: number; local: number | null }[] {
  return linhas.filter((l) => l.insumo === insumo).map((l) => ({ produto: l.produto, quantidade: l.quantidade, local: l.local }))
}
