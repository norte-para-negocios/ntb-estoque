// Executa no servidor uma server action pedida pelo app desktop, como o usuário logado (o proxy.ts
// já transformou o header Authorization em cookies de sessão). Idempotente por intentId: reenvio
// devolve o resultado gravado e nunca roda a ação de novo (evita ajuste em dobro no Omie).
// POST {intentId, acao: 'modulo#funcao', args}
import { createServiceClient } from '@/lib/supabase/server'
import { autenticarCanal, erro } from '@/lib/offline/canal'
import { comContexto } from '@/lib/offline/contexto'
import { ACOES } from '@/lib/offline/registro-acoes'
import { desserializarArgs, lerDigest, serializarValor, type Json } from '@/lib/offline/serializacao'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const EM_ANDAMENTO_TRAVADO_MS = 10 * 60_000

export async function POST(req: Request) {
  const u = await autenticarCanal(req)
  if (u instanceof Response) return u

  let body: { intentId?: string; acao?: string; args?: Json }
  try {
    body = await req.json()
  } catch {
    return erro(400, 'Pedido inválido.')
  }
  const intentId = String(body.intentId ?? '')
  const acao = String(body.acao ?? '')
  if (!/^[0-9a-f-]{36}$/.test(intentId)) return erro(400, 'Intent inválido.')
  const fn = Object.prototype.hasOwnProperty.call(ACOES, acao) ? ACOES[acao] : undefined
  if (typeof fn !== 'function') return erro(400, 'Ação desconhecida. Atualize o app.', { tipo: 'versao' })

  const svc = createServiceClient()
  const { error: erroReserva } = await svc
    .from('offline_execucoes')
    .insert({ intent_id: intentId, user_id: u.userId, acao, status: 'em_andamento' })
  if (erroReserva) {
    // Já existe: devolve o que ficou gravado (só para o mesmo usuário).
    const { data: ant } = await svc.from('offline_execucoes').select('*').eq('intent_id', intentId).maybeSingle()
    if (!ant || ant.user_id !== u.userId) return erro(409, 'Intent já usado.')
    if (ant.status === 'em_andamento') {
      const idade = Date.now() - new Date(ant.atualizado_em).getTime()
      if (idade < EM_ANDAMENTO_TRAVADO_MS) return erro(409, 'Ainda processando.', { tipo: 'processando' })
      return Response.json({ ok: false, tipo: 'em_andamento', erro: 'O servidor não confirmou se esta operação foi feita. Confira na tela antes de refazer.' })
    }
    return Response.json(ant.resultado)
  }

  let resultado: Record<string, unknown>
  let status: 'ok' | 'erro' = 'ok'
  try {
    const args = desserializarArgs(body.args ?? [])
    const valor = await comContexto({ intentId }, () => fn(...args))
    resultado = { ok: true, valor: await serializarValor(valor) }
  } catch (e) {
    const interrupcao = lerDigest(e)
    if (interrupcao?.tipo === 'redirect') {
      resultado = { ok: true, redirect: interrupcao }
    } else if (interrupcao?.tipo === 'notfound') {
      resultado = { ok: true, notFound: true }
    } else {
      status = 'erro'
      console.error('offline/acao', acao, e)
      resultado = { ok: false, tipo: 'negocio', erro: e instanceof Error ? e.message : 'Erro ao executar a ação.' }
    }
  }

  const { data: criados } = await svc.rpc('offline_criados', { p_intent: intentId })
  resultado.criados = (criados ?? []).map((c: { tabela: string; pk: unknown }) => ({ tabela: c.tabela, pk: c.pk }))

  await svc
    .from('offline_execucoes')
    .update({ status, resultado, atualizado_em: new Date().toISOString() })
    .eq('intent_id', intentId)
  return Response.json(resultado)
}
