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

// PostgREST/nginx tem limite de tamanho de URL (~8KB) -- um `.in('id', [...])`
// com uma lista grande de ids gera uma URL enorme e falha com 414 URI Too
// Long. Achado real (Task 10 da auditoria de filtros/relatorios, 2026-08-05):
// em Notas Fiscais, o filtro de tipo/familia/produto/local resolve
// `nota_fiscal_id` casando em TODO o historico da loja (sem limite de data --
// os ids so sao cruzados com o periodo DEPOIS, na query final) -- pra um tipo
// comum (loja 3, tipo='01' = Materia Prima) isso gera uma lista de 1626 ids
// (~10.9KB), e o `.in('id', idsIn)` resultante falhava com 414 SEMPRE,
// mesmo pra periodos 100% dentro da janela quente (sem qualquer fallback do
// Contabo pra mascarar). Como `buscarTudoPaginado` trata QUALQUER erro da
// query como "acabaram as paginas" (nao distingue "sem mais dados" de "a
// query falhou"), o filtro virava silenciosamente "nenhuma nota encontrada"
// -- o mesmo bug, em espirito, que ja foi corrigido do lado do Contabo em
// `buscarFrio`/`buscarFrioTudo` (historico-contabo.ts), so que aqui do lado
// do Supabase. Corrige quebrando os ids em lotes bem menores que o limite de
// URL, rodando os lotes em paralelo (cada lote e independente, ids nunca se
// repetem entre lotes) e juntando o resultado -- mesmo espirito de
// `buscarTudoPaginado` (quebra por OFFSET) e `buscarComPaginacaoPorData`
// (quebra por DATA), aqui quebrando por ID. Cada lote de 200 ids retorna no
// maximo 200 linhas (ids sao a chave primaria da tabela-alvo), bem abaixo do
// teto de 1000 linhas do PostgREST -- não precisa de `.range()` dentro do
// lote.
const TAMANHO_LOTE_IDS = 200

export async function buscarTodosPorIds<T>(
  ids: readonly (number | string)[],
  build: (lote: (number | string)[]) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const lotes: (number | string)[][] = []
  for (let i = 0; i < ids.length; i += TAMANHO_LOTE_IDS) lotes.push(ids.slice(i, i + TAMANHO_LOTE_IDS))
  const resultados = await Promise.all(lotes.map((lote) => build(lote)))
  return resultados.flatMap((r) => r.data ?? [])
}
