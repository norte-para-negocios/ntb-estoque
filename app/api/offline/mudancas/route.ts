// Pull: mudanças desde o cursor (máx. 5000 por chamada). Cursor abaixo do piso = refazer snapshot.
// POST {cursor}
import { createServiceClient } from '@/lib/supabase/server'
import { autenticarCanal, erro, jsonGzip } from '@/lib/offline/canal'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const u = await autenticarCanal(req)
  if (u instanceof Response) return u
  let cursor = 0
  try {
    cursor = Number((await req.json()).cursor) || 0
  } catch {
    return erro(400, 'Pedido inválido.')
  }
  const svc = createServiceClient()
  const { data: piso } = await svc.from('offline_meta').select('valor').eq('chave', 'piso_versao').maybeSingle()
  if (cursor < Number(piso?.valor ?? 0)) return jsonGzip({ ok: true, refazer: true, mudancas: [], cursor })
  await svc.rpc('offline_compactar')
  const { data, error } = await svc.rpc('offline_puxar', { p_lojas: u.lojas, p_user: u.userId, p_cursor: cursor, p_limite: 5000 })
  if (error) {
    console.error('offline/mudancas', error.message)
    return erro(500, 'Falha ao ler mudanças.')
  }
  const mudancas = (data ?? []) as { versao: number; tabela: string; pk: unknown; apagado: boolean; dado: unknown }[]
  const novo = mudancas.length ? Number(mudancas[mudancas.length - 1].versao) : cursor
  return jsonGzip({ ok: true, refazer: false, mudancas, cursor: novo, mais: mudancas.length >= 5000, lojaAtual: u.lojaAtual, lojas: u.lojas })
}
