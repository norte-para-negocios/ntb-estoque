import type { createServiceClient } from '@/lib/supabase/server'

type DbClient = ReturnType<typeof createServiceClient>

/**
 * Roda uma RPC paginando com .range() até trazer TODAS as linhas. O PostgREST
 * corta em 1000 por padrão; sem isto, RPCs que retornam muitas linhas (ex.: matriz
 * por família × meses) eram truncadas e os totais somados saíam subcontados.
 * A RPC precisa ter ORDER BY determinístico para a paginação ser segura.
 */
export async function rpcTodos<T>(
  db: DbClient,
  fn: string,
  args: Record<string, unknown>
): Promise<T[]> {
  const PAGE = 1000
  const todos: T[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await db.rpc(fn, args).range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    todos.push(...(data as T[]))
    if (data.length < PAGE) break
  }
  return todos
}
