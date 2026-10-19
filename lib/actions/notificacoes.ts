'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

// Fase G (migration 222): sininho. Lê as notificações abertas da loja atual (só os tipos que o usuário tem permissão de
// ver) e marca como lida por usuário. Nada aqui gera notificação (isso é o cron gerar-notificacoes).
import { createServiceClient } from '@/lib/supabase/server'
import { getProfile, requirePermissao } from '@/lib/auth'
import { PERMISSAO_DO_TIPO, TIPOS_NOTIFICACAO, type Gravidade, type TipoNotificacao } from '@/lib/notificacoes/regras-puro'
import { tabelaAusente } from '@/lib/supabase/tabela-ausente'

export type NotificacaoTela = {
  id: number
  tipo: TipoNotificacao
  gravidade: Gravidade
  titulo: string
  mensagem: string | null
  link: string | null
  atualizadaEm: string
  lida: boolean
}

const ehTipo = (t: string): t is TipoNotificacao => (TIPOS_NOTIFICACAO as readonly string[]).includes(t)

async function visiveis(): Promise<{ userId: string; itens: Omit<NotificacaoTela, 'lida'>[] } | null> {
  const perfil = await getProfile()
  const lojaId = perfil.current_loja_id
  if (!lojaId) return null
  const { data, error } = await createServiceClient().from('notificacoes')
    .select('id, tipo, gravidade, titulo, mensagem, link, atualizada_em')
    .eq('loja_id', lojaId).is('resolvida_em', null).order('atualizada_em', { ascending: false }).limit(50)
  if (error) {
    if (!tabelaAusente(error)) console.error('notificacoes: falha ao listar', error.message)
    return null
  }
  const tipos = [...new Set((data ?? []).map((n) => n.tipo as string).filter(ehTipo))]
  const pode = new Map<string, boolean>()
  for (const t of tipos) pode.set(t, await requirePermissao(lojaId, PERMISSAO_DO_TIPO[t]))
  const itens = (data ?? [])
    .filter((n) => ehTipo(n.tipo as string) && pode.get(n.tipo as string))
    .map((n) => ({
      id: Number(n.id), tipo: n.tipo as TipoNotificacao, gravidade: n.gravidade as Gravidade, titulo: n.titulo as string,
      mensagem: (n.mensagem as string | null) ?? null, link: (n.link as string | null) ?? null, atualizadaEm: n.atualizada_em as string,
    }))
  return { userId: perfil.id, itens }
}

export async function minhasNotificacoes(): Promise<{ itens: NotificacaoTela[]; naoLidas: number }> {
  const __d = viaDesktop('notificacoes#minhasNotificacoes', minhasNotificacoes, []); if (__d) return __d as never
  const v = await visiveis()
  if (!v || !v.itens.length) return { itens: [], naoLidas: 0 }
  const { data: leituras } = await createServiceClient().from('notificacoes_leituras').select('notificacao_id, lida_em')
    .eq('user_id', v.userId).in('notificacao_id', v.itens.map((i) => i.id))
  const lidaEm = new Map((leituras ?? []).map((l) => [Number(l.notificacao_id), l.lida_em as string]))
  const itens = v.itens.map((i) => {
    const l = lidaEm.get(i.id)
    return { ...i, lida: !!l && new Date(l).getTime() >= new Date(i.atualizadaEm).getTime() }
  })
  return { itens, naoLidas: itens.filter((i) => !i.lida).length }
}

async function marcar(ids: number[], userId: string): Promise<{ ok: true } | { error: string }> {
  if (!ids.length) return { ok: true }
  const agora = new Date().toISOString()
  const { error } = await createServiceClient().from('notificacoes_leituras')
    .upsert(ids.map((id) => ({ notificacao_id: id, user_id: userId, lida_em: agora })), { onConflict: 'notificacao_id,user_id' })
  return error ? { error: 'Não foi possível marcar agora' } : { ok: true }
}

export async function marcarNotificacaoLida(id: number): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('notificacoes#marcarNotificacaoLida', marcarNotificacaoLida, [id]); if (__d) return __d as never
  const v = await visiveis()
  if (!v || !v.itens.some((i) => i.id === id)) return { error: 'Notificação não encontrada' }
  return marcar([id], v.userId)
}

export async function marcarTodasLidas(): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('notificacoes#marcarTodasLidas', marcarTodasLidas, []); if (__d) return __d as never
  const v = await visiveis()
  if (!v) return { ok: true }
  return marcar(v.itens.map((i) => i.id), v.userId)
}
