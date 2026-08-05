import type { createServiceClient } from '@/lib/supabase/server'

type DbClient = ReturnType<typeof createServiceClient>

/**
 * Roda uma RPC paginando com .range() até trazer TODAS as linhas. O PostgREST
 * corta em 1000 por padrão; sem isto, RPCs que retornam muitas linhas (ex.: matriz
 * por família × meses) eram truncadas e os totais somados saíam subcontados.
 * A RPC precisa ter ORDER BY determinístico para a paginação ser segura.
 *
 * Hardening (revisão final da auditoria de filtros/relatórios, 2026-08-05):
 * antes, `if (error || !data?.length) break` tratava QUALQUER erro (RPC
 * inexistente/assinatura errada, timeout, etc.) exatamente igual a "acabaram
 * as páginas" -- a MESMA classe de bug que a migration 097 expôs em
 * `relatorio-compras/page.tsx` (RPC quebrada virava silenciosamente "0
 * linhas" em vez de erro visível, ver AGENTS.md e C1 desta rodada: as
 * migrations 087/089/091/095/096 nunca aplicadas em produção tinham esse
 * mesmo potencial aqui). Agora sempre loga o erro real (visível no log do
 * servidor mesmo que o caller não trate nada) e aceita um `onErro` opcional
 * pra quem quiser sinalizar de verdade pro usuário (mesmo padrão já usado em
 * `relatorio-compras/page.tsx`, ver `logErroRpc`) -- parâmetro adicional
 * opcional, não quebra nenhuma das chamadas existentes (nem a assinatura,
 * nem o tipo de retorno `Promise<T[]>`).
 */
export async function rpcTodos<T>(
  db: DbClient,
  fn: string,
  args: Record<string, unknown>,
  onErro?: (error: { message: string }) => void
): Promise<T[]> {
  const PAGE = 1000
  const todos: T[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await db.rpc(fn, args).range(p * PAGE, p * PAGE + PAGE - 1)
    if (error) {
      console.error(`rpcTodos: RPC "${fn}" falhou -- resultado pode estar incompleto/truncado`, error.message)
      onErro?.(error)
      break
    }
    if (!data?.length) break
    todos.push(...(data as T[]))
    if (data.length < PAGE) break
  }
  return todos
}
