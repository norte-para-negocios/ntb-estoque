'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { rotuloMes, validarFechamento, validarReabertura, type Pendencia } from '@/lib/estoque/periodo-fechado-puro'

// Fase F: fechar e reabrir um mês (as duas lojas). Escrita só pelas funções fechar_periodo/reabrir_periodo
// (migration 230, security definer, só service role), depois da permissão. Precisa de internet (fora da política offline).

type Erro = { error: string }

async function contexto(permissao: string): Promise<{ lojaId: number; userId: string; nome: string } | Erro> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const perfil = await getProfile()
  return { lojaId, userId: perfil.id, nome: perfil.name }
}

const msgErro = (e: { message?: string; code?: string } | null | undefined) => {
  if ((e?.code === '22023' || e?.code === 'PF001') && e.message) return e.message
  if (/fechar_periodo|reabrir_periodo/.test(e?.message ?? '')) return 'O fechamento de mês ainda não foi ativado nesta instalação (migration 230).'
  console.error('fechamento:', e?.message)
  return 'Não foi possível concluir agora. Tente de novo; se continuar, avise o suporte.'
}

/** Fecha o mês (YYYY-MM). Com pendência, só fecha com `aceitarPendencias` (a tela mostra a lista antes). */
export async function fecharMes(mes: string, opts?: { obs?: string | null; aceitarPendencias?: boolean }): Promise<{ ok: true; duplicado: boolean } | (Erro & { pendencias?: Pendencia[] })> {
  const __d = viaDesktop('periodo-fechado#fecharMes', fecharMes, [mes, opts]); if (__d) return __d as never
  const ctx = await contexto('Fechamento - Fechar mes')
  if ('error' in ctx) return ctx
  const inval = validarFechamento(mes, hojeBahiaISO())
  if (inval) return { error: inval }
  const { data, error } = await createServiceClient().rpc('fechar_periodo', {
    p_loja: ctx.lojaId, p_mes: `${mes}-01`, p_user: ctx.userId, p_user_nome: ctx.nome, p_obs: opts?.obs ?? null,
    p_aceitar_pendencias: opts?.aceitarPendencias === true,
  })
  if (error) return { error: msgErro(error) }
  const r = data as { ok: boolean; duplicado?: boolean; pendencias?: Pendencia[] }
  if (!r.ok) return { error: `${rotuloMes(mes)} tem envios pendentes com data no mês. Confira a lista e confirme se quer fechar assim mesmo.`, pendencias: r.pendencias ?? [] }
  if (!r.duplicado) await registrarAuditoria('fechar', 'mês', mes, opts?.obs ?? null)
  revalidatePath('/contador')
  return { ok: true, duplicado: !!r.duplicado }
}

/** Reabre o mês (YYYY-MM): permissão própria e motivo obrigatório, registrados. */
export async function reabrirMes(mes: string, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('periodo-fechado#reabrirMes', reabrirMes, [mes, motivo]); if (__d) return __d as never
  const ctx = await contexto('Fechamento - Reabrir mes')
  if ('error' in ctx) return ctx
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { error: 'Mês inválido.' }
  const inval = validarReabertura(motivo)
  if (inval) return { error: inval }
  const { error } = await createServiceClient().rpc('reabrir_periodo', {
    p_loja: ctx.lojaId, p_mes: `${mes}-01`, p_user: ctx.userId, p_user_nome: ctx.nome, p_motivo: motivo.trim(),
  })
  if (error) return { error: msgErro(error) }
  await registrarAuditoria('reabrir', 'mês', mes, motivo.trim())
  revalidatePath('/contador')
  return { ok: true }
}

/** O que impede (ou fica parado ao) fechar o mês, para a tela mostrar antes de confirmar. */
export async function pendenciasDoMes(mes: string): Promise<{ pendencias: Pendencia[] } | Erro> {
  const __d = viaDesktop('periodo-fechado#pendenciasDoMes', pendenciasDoMes, [mes]); if (__d) return __d as never
  const ctx = await contexto('Fechamento - Fechar mes')
  if ('error' in ctx) return ctx
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { error: 'Mês inválido.' }
  const { data, error } = await createServiceClient().rpc('periodo_pendencias', { p_loja: ctx.lojaId, p_mes: `${mes}-01` })
  if (error) return { error: msgErro(error) }
  return { pendencias: (data as Pendencia[]) ?? [] }
}
