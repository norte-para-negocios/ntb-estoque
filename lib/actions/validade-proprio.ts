'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { baixarLote } from '@/lib/estoque/lotes'

type Resposta = { ok: true; aviso?: string } | { error: string }

async function contexto(permissao: string): Promise<{ lojaId: number; userId: string | null } | { error: string }> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa o estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const user = await getUser()
  return { lojaId, userId: user?.id ?? null }
}

function atualizar() {
  revalidatePath('/validade')
  revalidatePath('/estoque')
  revalidatePath('/home')
  revalidatePath('/reposicao')
}

/** 'Dar baixa por vencimento': saída com origem PERDA, dirigida ao lote escolhido, com motivo. */
export async function baixarLoteVencido(dados: { loteId: number; quantidade: number | string; motivo: string }): Promise<Resposta> {
  const __d = viaDesktop('validade-proprio#baixarLoteVencido', baixarLoteVencido, [dados]); if (__d) return __d as never
  const ctx = await contexto('Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  const quantidade = Number(String(dados.quantidade ?? '').replace(',', '.'))
  if (!Number.isFinite(quantidade) || quantidade <= 0) return { error: 'Informe uma quantidade maior que zero.' }
  const motivo = dados.motivo?.trim() ?? ''
  if (motivo.length < 3) return { error: 'Informe o motivo da baixa.' }
  const { data: lote } = await createServiceClient()
    .from('estoque_lotes').select('id, lote, codigo_produto, saldo').eq('id', dados.loteId).eq('loja_id', ctx.lojaId).maybeSingle()
  if (!lote) return { error: 'Lote não encontrado nesta loja.' }
  try {
    const r = await baixarLote({
      lojaId: ctx.lojaId, loteId: dados.loteId, quantidade, motivo,
      ref: `venc:${dados.loteId}:${Date.now().toString(36)}`, user: ctx.userId,
    })
    await registrarAuditoria('criar', 'baixa por vencimento', r.id, `lote ${lote.lote ?? 'sem lote'} · ${quantidade} · ${motivo}`)
    atualizar()
    return { ok: true, aviso: r.negativo ? 'Atenção: o saldo do produto ficou negativo.' : undefined }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao dar baixa no lote' }
  }
}

/** Quantos dias antes do vencimento o lote entra no alerta (Início, Reposição, filtro padrão da tela). */
export async function salvarAlertaValidade(dias: number | string): Promise<Resposta> {
  const __d = viaDesktop('validade-proprio#salvarAlertaValidade', salvarAlertaValidade, [dias]); if (__d) return __d as never
  const ctx = await contexto('Validade')
  if ('error' in ctx) return ctx
  const n = Math.trunc(Number(dias))
  if (!Number.isFinite(n) || n < 1 || n > 365) return { error: 'Use entre 1 e 365 dias.' }
  const { error } = await createServiceClient().from('estoque_config').upsert({ loja_id: ctx.lojaId, validade_alerta_dias: n, updated_at: new Date().toISOString() }, { onConflict: 'loja_id' })
  if (error) return { error: error.message }
  atualizar()
  return { ok: true }
}

/** Corrige diferença entre lotes e saldo (só no "saldo sem lote"; nunca mexe em lote com validade). */
export async function reconciliarLotes(): Promise<{ ok: true; corrigidos: number } | { error: string }> {
  const __d = viaDesktop('validade-proprio#reconciliarLotes', reconciliarLotes, []); if (__d) return __d as never
  const ctx = await contexto('Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('reconciliar_lotes', { p_loja: ctx.lojaId })
  if (error) return { error: error.message }
  atualizar()
  return { ok: true, corrigidos: Number(data) || 0 }
}
