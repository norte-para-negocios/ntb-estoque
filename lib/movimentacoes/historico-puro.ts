// Aba Histórico de /movimentacoes (movimentos_historico: total do Omie por produto/dia). Agregação pura, sem imports:
// node --test lib/movimentacoes/historico-puro.test.ts. A tela lê o período uma vez só e agrega/pagina aqui.

export type LinhaHist = { cod_prod: number; codigo: string | null; descricao: string | null; data: string; entradas: number; saidas: number }
export type LinhaHistExibida = { chave: string; quando: string; cod_prod: number; codigo: string | null; descricao: string | null; entradas: number; saidas: number }

export function agregarHistorico(
  rows: LinhaHist[],
  o: { porMes: boolean; mov: '' | 'entrada' | 'saida'; codigos: Set<number> | null; page: number; porPagina: number },
): { linhas: LinhaHistExibida[]; totalEntradas: number; totalSaidas: number; temProxima: boolean } {
  const grupos = new Map<string, LinhaHistExibida>()
  for (const r of rows) {
    const cod = Number(r.cod_prod)
    if (o.codigos && !o.codigos.has(cod)) continue
    const quando = o.porMes ? String(r.data).slice(0, 7) : String(r.data).slice(0, 10)
    const chave = `${cod}-${quando}`
    let g = grupos.get(chave)
    if (!g) {
      g = { chave, quando, cod_prod: cod, codigo: r.codigo, descricao: r.descricao, entradas: 0, saidas: 0 }
      grupos.set(chave, g)
    }
    g.entradas += Number(r.entradas) || 0
    g.saidas += Number(r.saidas) || 0
  }
  let arr = [...grupos.values()]
  if (o.mov === 'entrada') arr = arr.filter((g) => g.entradas > 0)
  else if (o.mov === 'saida') arr = arr.filter((g) => g.saidas > 0)
  // Totais sempre do conjunto filtrado (o que a tabela mostra), não da página.
  let totalEntradas = 0
  let totalSaidas = 0
  for (const g of arr) { totalEntradas += g.entradas; totalSaidas += g.saidas }
  arr.sort((a, b) => (a.quando !== b.quando ? (a.quando < b.quando ? 1 : -1) : b.saidas - a.saidas || a.cod_prod - b.cod_prod))
  const page = Math.max(1, o.page)
  return {
    linhas: arr.slice((page - 1) * o.porPagina, page * o.porPagina),
    totalEntradas, totalSaidas, temProxima: arr.length > page * o.porPagina,
  }
}
