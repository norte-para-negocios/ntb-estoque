// Autenticação e utilidades das rotas /api/offline/* (canal do app desktop). Só servidor.
import { gzipSync } from 'node:zlib'
import { createServiceClient } from '@/lib/supabase/server'

export const OFFLINE_VERSAO_MINIMA = '1.0.0'

export type UsuarioCanal = { userId: string; email: string | null; lojas: number[]; permitidas: number[]; admin: boolean; lojaAtual: number | null }

function compararVersao(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number(x) || 0)
  const pb = b.split('.').map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

export function erro(status: number, mensagem: string, extra?: Record<string, unknown>) {
  return Response.json({ ok: false, erro: mensagem, ...extra }, { status })
}

/**
 * Valida o token do usuário (Authorization: Bearer) no GoTrue, a versão do app e calcula as lojas
 * que ele pode baixar: as de loja_user + a loja atual; admin pode pedir qualquer loja.
 * `x-ntb-lojas` (lista separada por vírgula) restringe ao que o app quer sincronizar.
 */
export async function autenticarCanal(req: Request): Promise<UsuarioCanal | Response> {
  const versao = req.headers.get('x-ntb-versao') ?? '0.0.0'
  if (compararVersao(versao, OFFLINE_VERSAO_MINIMA) < 0) {
    return erro(426, 'Atualize o app Norte Estoque para continuar sincronizando.', { tipo: 'versao' })
  }
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return erro(401, 'Sessão ausente.')
  const svc = createServiceClient()
  const { data, error } = await svc.auth.getUser(auth.slice(7))
  if (error || !data.user) return erro(401, 'Sessão expirada.')
  const userId = data.user.id

  const [{ data: perfil }, { data: vinculos }] = await Promise.all([
    svc.from('profiles').select('perfil, is_super_admin, status, current_loja_id').eq('id', userId).maybeSingle(),
    svc.from('loja_user').select('loja_id').eq('user_id', userId),
  ])
  if (!perfil || perfil.status === 'pendente') return erro(403, 'Usuário sem acesso liberado.')
  const admin = perfil.perfil === 'Admin' || perfil.is_super_admin === true
  const lojaAtual = (perfil.current_loja_id as number | null) ?? null
  const proprias = new Set<number>((vinculos ?? []).map((v) => Number(v.loja_id)))

  let permitidas: Set<number>
  if (admin) {
    const { data: todas } = await svc.from('lojas').select('id')
    permitidas = new Set((todas ?? []).map((l) => Number(l.id)))
  } else {
    permitidas = new Set(proprias)
  }

  const pedidas = (req.headers.get('x-ntb-lojas') ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
  let lojas: number[]
  if (pedidas.length) {
    lojas = pedidas.filter((n) => permitidas.has(n))
  } else {
    const padrao = new Set(proprias)
    if (lojaAtual && permitidas.has(lojaAtual)) padrao.add(lojaAtual)
    lojas = [...padrao]
  }
  return { userId, email: data.user.email ?? null, lojas: lojas.sort((a, b) => a - b), permitidas: [...permitidas].sort((a, b) => a - b), admin, lojaAtual }
}

/** Resposta JSON compactada (snapshot e pull podem ter milhares de linhas). */
export function jsonGzip(dado: unknown, status = 200): Response {
  const corpo = gzipSync(Buffer.from(JSON.stringify(dado)))
  return new Response(corpo, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip', 'cache-control': 'no-store' },
  })
}

// Limite simples de tentativas de login por IP+e-mail (memória do processo).
const tentativas = new Map<string, number[]>()
export function excedeuTentativas(chave: string, max = 5, janelaMs = 60_000): boolean {
  const agora = Date.now()
  const lista = (tentativas.get(chave) ?? []).filter((t) => agora - t < janelaMs)
  lista.push(agora)
  tentativas.set(chave, lista)
  if (tentativas.size > 5000) tentativas.clear()
  return lista.length > max
}

export function ipDe(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'desconhecido'
}
