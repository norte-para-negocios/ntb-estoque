// Lê páginas (OFFSET) em ondas paralelas até uma página vir incompleta. Sem imports (node --test).
// O app e o banco ficam em continentes diferentes: N páginas em série pagam N idas e voltas; em ondas, ~N/onda.
// A ordem da consulta precisa ser total (ex.: .order('id') no fim), senão OFFSET repete/pula linhas.

export async function paginasEmOndas<T>(
  buscarPagina: (pagina: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanhoPagina: number,
  onda = 4,
): Promise<{ linhas: T[]; falhou: boolean }> {
  const linhas: T[] = []
  for (let inicio = 0; ; inicio += onda) {
    const res = await Promise.all(Array.from({ length: onda }, (_, i) => buscarPagina(inicio + i)))
    for (const r of res) {
      if (r.error) return { linhas, falhou: true }
      const d = r.data ?? []
      linhas.push(...d)
      if (d.length < tamanhoPagina) return { linhas, falhou: false }
    }
  }
}
