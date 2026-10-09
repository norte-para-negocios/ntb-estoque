// Login e renovação de sessão do app desktop (o GoTrue de produção não é público).
// POST {acao:'entrar', email, senha} | {acao:'renovar', refresh}
import { createClient } from '@supabase/supabase-js'
import { urlEChaveAtuais } from '@/lib/supabase/server'
import { erro, excedeuTentativas, ipDe, autenticarCanal } from '@/lib/offline/canal'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { acao?: string; email?: string; senha?: string; refresh?: string }
  try {
    body = await req.json()
  } catch {
    return erro(400, 'Pedido inválido.')
  }
  const { url, key } = urlEChaveAtuais('anon')
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  let sessao
  if (body.acao === 'entrar') {
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!email || !body.senha) return erro(400, 'Informe e-mail e senha.')
    if (excedeuTentativas(`${ipDe(req)}|${email}`)) return erro(429, 'Muitas tentativas. Espere um minuto.')
    const { data, error } = await sb.auth.signInWithPassword({ email, password: String(body.senha) })
    if (error || !data.session) return erro(401, 'E-mail ou senha inválidos.')
    sessao = data.session
  } else if (body.acao === 'renovar') {
    if (!body.refresh) return erro(400, 'Sessão ausente.')
    if (excedeuTentativas(`${ipDe(req)}|renovar`, 60)) return erro(429, 'Muitas tentativas.')
    const { data, error } = await sb.auth.refreshSession({ refresh_token: String(body.refresh) })
    if (error || !data.session) return erro(401, 'Sessão expirada. Entre de novo.')
    sessao = data.session
  } else {
    return erro(400, 'Ação inválida.')
  }

  // Mesmas regras do canal (usuário pendente não entra), já com o token novo.
  const headers = new Headers(req.headers)
  headers.set('authorization', `Bearer ${sessao.access_token}`)
  const u = await autenticarCanal(new Request(req.url, { headers }))
  if (u instanceof Response) return u

  return Response.json({
    ok: true,
    sessao: {
      access_token: sessao.access_token,
      refresh_token: sessao.refresh_token,
      expires_at: sessao.expires_at,
      user: { id: sessao.user.id, email: sessao.user.email, app_metadata: sessao.user.app_metadata, user_metadata: sessao.user.user_metadata },
    },
    lojas: u.lojas,
    admin: u.admin,
    lojaAtual: u.lojaAtual,
  })
}
