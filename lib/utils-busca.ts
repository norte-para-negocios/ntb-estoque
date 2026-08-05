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

// PostgREST/nginx tem limite de tamanho de URL (~8KB) -- um `.in('coluna',
// [...])` com uma lista grande de valores gera uma URL enorme e falha com 414
// URI Too Long. Achado real (Task 10 da auditoria de filtros/relatorios,
// 2026-08-05): em Notas Fiscais, o filtro de tipo/familia/produto/local usa
// DOIS `.in()` em sequencia, os dois vulneraveis a essa mesma escala --
// (1) `nota_fiscal_items.in('produto_codigo', codigos)`, onde `codigos` vem
// de produtos.tipo_item/descricao_familia (loja 3, tipo='07' = Material de
// Uso e Consumo, 633 produtos -- 414 mesmo so nesse primeiro passo); (2)
// `notas_fiscais.in('id', notaIds)`, resolvido em TODO o historico da loja
// sem limite de data (loja 3, tipo='01' = Materia Prima, 1626 ids -- 414 no
// segundo passo, mesmo quando o primeiro passa por ter poucos produtos).
// Como `buscarTudoPaginado` trata QUALQUER erro da query como "acabaram as
// paginas" (nao distingue "sem mais dados" de "a query falhou"), qualquer um
// dos dois pontos falhando vira silenciosamente "nenhuma nota encontrada" --
// o mesmo bug, em espirito, que ja foi corrigido do lado do Contabo em
// `buscarFrio`/`buscarFrioTudo` (historico-contabo.ts), so que aqui do lado
// do Supabase, em cascata. Corrige quebrando os valores em lotes bem menores
// que o limite de URL, rodando os lotes em paralelo (cada lote e
// independente, valores nunca se repetem entre lotes) -- mesmo espirito de
// `buscarComPaginacaoPorData` (quebra por DATA), aqui quebrando por
// valor/id. Cada lote AINDA pagina por OFFSET internamente (via
// `buscarTudoPaginado`): quando o valor filtrado e uma chave primaria (ex.:
// `notas_fiscais.id`) um lote de 200 nunca passa de 200 linhas, mas quando
// NAO e (ex.: `produto_codigo` -- um so codigo pode aparecer em centenas de
// itens de NF), um lote pequeno de valores ainda pode devolver mais de 1000
// linhas, e paginar por OFFSET evita o mesmo estouro silencioso do PostgREST
// (ver `buscarTudoPaginado` acima) dentro de cada lote.
const TAMANHO_LOTE_IDS = 200

export async function buscarTodosPorIds<T>(
  ids: readonly (number | string)[],
  build: (lote: (number | string)[], from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const lotes: (number | string)[][] = []
  for (let i = 0; i < ids.length; i += TAMANHO_LOTE_IDS) lotes.push(ids.slice(i, i + TAMANHO_LOTE_IDS))
  const resultados = await Promise.all(
    lotes.map((lote) => buscarTudoPaginado<T>((from, to) => build(lote, from, to))),
  )
  return resultados.flat()
}
