/**
 * Pagina um `.select()` de tabela (não-RPC) até trazer TODAS as linhas. O
 * PostgREST corta em 1000 por padrão; sem isto, tabelas grandes (`produtos`,
 * `posicao_estoques`) truncavam silenciosamente pra lojas com catálogo acima
 * de 1000 linhas.
 *
 * Extraído de 3 cópias locais idênticas (`app/(app)/relatorio-margem/page.tsx`,
 * `.../export/route.ts`, `app/api/cron/snapshot-margem-diario/route.ts`) que
 * NENHUMA checava `error` -- mesma classe de bug que `lib/supabase/rpc-todos.ts`
 * já corrige pra RPCs (auditoria de filtros/relatórios, 2026-08-05): uma falha
 * de query no meio da paginação (timeout, RLS, conexão) virava silenciosamente
 * "acabaram as páginas" em vez de erro visível, e o resultado parcial seguia
 * como se fosse completo. Agora sempre loga o erro real e aceita um `onErro`
 * opcional pra quem quiser sinalizar de verdade pro usuário (mesmo padrão de
 * `rpcTodos`).
 */
export async function buscarTodasLinhas<T>(
  montar: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  contar?: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  onErro?: (error: { message: string }) => void,
): Promise<T[]> {
  const PAGE = 1000

  function logErro(error: { message: string }) {
    console.error('buscarTodasLinhas: consulta falhou -- resultado pode estar incompleto/truncado', error.message)
    onErro?.(error)
  }

  if (contar) {
    const { count, error: erroContar } = await contar()
    if (erroContar) {
      logErro(erroContar)
      return []
    }
    const numPaginas = Math.ceil((count ?? 0) / PAGE)
    const blocos = await Promise.all(
      Array.from({ length: numPaginas }, (_, p) => montar(p * PAGE, p * PAGE + PAGE - 1)),
    )
    for (const b of blocos) {
      if (b.error) logErro(b.error)
    }
    return blocos.flatMap((r) => r.data ?? [])
  }

  const todas: T[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await montar(p * PAGE, p * PAGE + PAGE - 1)
    if (error) {
      logErro(error)
      break
    }
    if (!data?.length) break
    todas.push(...data)
    if (data.length < PAGE) break
  }
  return todas
}
