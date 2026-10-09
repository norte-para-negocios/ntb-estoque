// Versão atual de linhas específicas (reconciliação depois da fila offline).
// POST {itens: [{tabela, pks: [{...}]}]} -> {linhas: [{tabela, pk, dado|null}]}
import { createServiceClient } from '@/lib/supabase/server'
import { autenticarCanal, erro, jsonGzip } from '@/lib/offline/canal'

export const dynamic = 'force-dynamic'

// jsonb devolve as chaves em outra ordem; compara pk com chaves ordenadas.
const chave = (pk: unknown) => JSON.stringify(Object.fromEntries(Object.entries(pk as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))))

export async function POST(req: Request) {
  const u = await autenticarCanal(req)
  if (u instanceof Response) return u
  let itens: { tabela: string; pks: Record<string, unknown>[] }[]
  try {
    itens = (await req.json()).itens
    if (!Array.isArray(itens) || itens.length > 200) throw new Error()
  } catch {
    return erro(400, 'Pedido inválido.')
  }
  const svc = createServiceClient()
  const saida: { tabela: string; pk: unknown; dado: unknown }[] = []
  for (const it of itens) {
    if (!/^[a-z_][a-z0-9_]*$/.test(it.tabela) || !Array.isArray(it.pks) || it.pks.length > 1000) return erro(400, 'Pedido inválido.')
    const { data, error } = await svc.rpc('offline_buscar_linhas', { p_tabela: it.tabela, p_pks: it.pks, p_lojas: u.lojas, p_user: u.userId })
    if (error) return erro(400, `Tabela ${it.tabela} não sincronizável.`)
    const achadas = new Map(((data ?? []) as { pk: unknown; dado: unknown }[]).map((r) => [chave(r.pk), r.dado]))
    for (const pk of it.pks) saida.push({ tabela: it.tabela, pk, dado: achadas.get(chave(pk)) ?? null })
  }
  return jsonGzip({ ok: true, linhas: saida })
}
