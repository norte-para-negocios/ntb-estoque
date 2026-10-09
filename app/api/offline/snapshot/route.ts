// Uma página do snapshot de uma tabela, só das lojas do usuário. GET ?tabela=&depois=<json>&limite=
import { createServiceClient } from '@/lib/supabase/server'
import { autenticarCanal, erro, jsonGzip } from '@/lib/offline/canal'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const u = await autenticarCanal(req)
  if (u instanceof Response) return u
  const sp = new URL(req.url).searchParams
  const tabela = sp.get('tabela') ?? ''
  if (!/^[a-z_][a-z0-9_]*$/.test(tabela)) return erro(400, 'Tabela inválida.')
  let depois: unknown = null
  try {
    depois = sp.get('depois') ? JSON.parse(sp.get('depois')!) : null
  } catch {
    return erro(400, 'Cursor inválido.')
  }
  const limite = Math.min(Math.max(Number(sp.get('limite')) || 5000, 1), 5000)
  const { data, error } = await createServiceClient().rpc('offline_snapshot', {
    p_tabela: tabela,
    p_lojas: u.lojas,
    p_user: u.userId,
    p_depois: depois,
    p_limite: limite,
  })
  if (error) {
    console.error('offline/snapshot', tabela, error.message)
    return erro(400, 'Tabela não sincronizável.')
  }
  const linhas = (data ?? []) as { pk: unknown; dado: unknown }[]
  return jsonGzip({ ok: true, linhas: linhas.map((l) => l.dado), depois: linhas.length ? linhas[linhas.length - 1].pk : null, fim: linhas.length < limite })
}
