/**
 * Escapa curingas do PostgREST/SQL LIKE para uso em `.ilike()`.
 * Escapa `\`, `%` e `_` para que sejam tratados como literais.
 */
export function escapeIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * Versao para uso dentro de `.or(...)` do PostgREST. Alem de escapar os
 * curingas do LIKE, remove/neutraliza caracteres que quebram a sintaxe do
 * filtro `.or()` quando vem do input do usuario: virgula (separa condicoes)
 * e parenteses (agrupam condicoes).
 */
export function escapeIlikeOr(s: string): string {
  return escapeIlike(s).replace(/[(),]/g, ' ')
}

/**
 * PostgREST/supabase-js limita resultados a 1000 linhas por padrao, SEM erro --
 * confirmado em producao (ex: nota_fiscal_items de qualquer loja ja passa de
 * 1000 linhas, produtos.tipo_item="99" da loja 6 tem 1143). Usar sempre que uma
 * query precisa buscar TODAS as linhas que casam (ex: resolver ids pra filtrar
 * depois), nao so uma pagina visivel pro usuario -- senao o filtro trunca em
 * silencio e some com resultado valido.
 *
 * `contar`: quando informado (count exato da MESMA tabela/filtros, via
 * `{count: 'exact', head: true}`, sem trazer linha nenhuma), busca todas as
 * paginas em paralelo em vez de uma de cada vez -- achado real (usuario
 * reportou sistema lento, 2026-07-28): o app roda no Contabo (Franca), o
 * banco fica no Brasil, cada ida paga ~230-460ms de latencia de rede pura, e
 * paginacao sequencial multiplica isso por pagina. Sem `contar`, mantem o
 * comportamento sequencial original (rede de seguranca pros call sites que
 * ainda nao passam essa contagem).
 */
export async function buscarTudoPaginado<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  contar?: () => PromiseLike<{ count: number | null }>,
): Promise<T[]> {
  const PAGE_SIZE = 1000
  if (contar) {
    const { count } = await contar()
    const numPaginas = Math.ceil((count ?? 0) / PAGE_SIZE)
    const blocos = await Promise.all(
      Array.from({ length: numPaginas }, (_, pagina) => build(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE - 1))
    )
    return blocos.flatMap((r) => r.data ?? [])
  }
  const tudo: T[] = []
  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data } = await build(from, from + PAGE_SIZE - 1)
    if (!data?.length) break
    tudo.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return tudo
}
