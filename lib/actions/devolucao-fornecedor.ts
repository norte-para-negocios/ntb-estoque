'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { validarDevolucao, type ItemPedidoDevolucao } from '@/lib/compras/devolucao-puro'
import { disponiveisDaCompra } from '@/lib/compras/devolucao-loader'

// Fase F [H1]: devolução ao fornecedor (só estoque próprio), SEM emitir NF-e. Escrita só pelas funções da migration 231
// (security definer, só service role), depois da permissão. Precisa de internet (fora da política offline).

type Erro = { error: string }

async function contexto(): Promise<{ lojaId: number; userId: string; nome: string } | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Devolução ao fornecedor pelo app só existe na loja de estoque próprio.' }
  if (!(await requirePermissao(lojaId, 'Compras - Devolucao ao fornecedor'))) return { error: 'Sem permissão' }
  const perfil = await getProfile()
  return { lojaId, userId: perfil.id, nome: perfil.name }
}

const msgErro = (e: { message?: string; code?: string } | null | undefined) => {
  if ((e?.code === '22023' || e?.code === 'PF001') && e.message) return e.message
  if (/devolucao_fornecedor/.test(e?.message ?? '')) return 'A devolução ao fornecedor ainda não foi ativada nesta instalação (migration 231).'
  console.error('devolucao-fornecedor:', e?.message)
  return 'Não foi possível concluir agora. Tente de novo; se continuar, avise o suporte.'
}

function atualizar(notaId?: number | null) {
  revalidatePath('/devolucao-fornecedor')
  if (notaId) revalidatePath(`/nota-fiscal/${notaId}`)
  revalidatePath('/estoque')
}

/** Registra a devolução: os itens saem do estoque na hora (ao custo da entrada) e ficam "Devolução a emitir". */
export async function registrarDevolucao(input: { compraId: number; itens: ItemPedidoDevolucao[]; motivo: string; chave: string }): Promise<{ ok: true; id: number; numero: number } | Erro> {
  const __d = viaDesktop('devolucao-fornecedor#registrarDevolucao', registrarDevolucao, [input]); if (__d) return __d as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  const disp = await disponiveisDaCompra(ctx.lojaId, input.compraId)
  if (disp === null) return { error: 'A devolução ao fornecedor ainda não foi ativada nesta instalação (migration 231).' }
  const itens = (input.itens ?? []).filter((i) => Number(i.quantidade) > 0)
  const inval = validarDevolucao(itens, new Map(disp.map((d) => [d.compraItemId, d.disponivel])), input.motivo)
  if (inval) return { error: inval }
  const cfop = new Map(disp.map((d) => [d.compraItemId, d.cfop]))
  const { data, error } = await createServiceClient().rpc('devolucao_fornecedor_registrar', {
    p_loja: ctx.lojaId, p_compra: input.compraId, p_motivo: input.motivo.trim(), p_user: ctx.userId, p_user_nome: ctx.nome,
    p_chave: input.chave || null,
    p_itens: itens.map((i) => ({ compra_item_id: i.compraItemId, quantidade: i.quantidade, cfop: cfop.get(i.compraItemId) ?? null })),
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; numero: number; duplicado: boolean }
  if (!r.duplicado) await registrarAuditoria('criar', 'devolução ao fornecedor', r.id, `Devolução nº ${r.numero}`)
  const { data: c } = await createServiceClient().from('compras_proprio').select('nota_fiscal_id').eq('id', input.compraId).eq('loja_id', ctx.lojaId).maybeSingle()
  atualizar((c as { nota_fiscal_id: number | null } | null)?.nota_fiscal_id)
  return { ok: true, id: r.id, numero: r.numero }
}

/** Cancela a devolução ainda não emitida: os itens voltam ao estoque. */
export async function cancelarDevolucao(id: number, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('devolucao-fornecedor#cancelarDevolucao', cancelarDevolucao, [id, motivo]); if (__d) return __d as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  if ((motivo ?? '').trim().length < 3) return { error: 'Informe o motivo do cancelamento.' }
  const { error } = await createServiceClient().rpc('devolucao_fornecedor_cancelar', {
    p_loja: ctx.lojaId, p_id: id, p_user: ctx.userId, p_user_nome: ctx.nome, p_motivo: motivo.trim(),
  })
  if (error) return { error: msgErro(error) }
  await registrarAuditoria('cancelar', 'devolução ao fornecedor', id, motivo.trim())
  const { data: d } = await createServiceClient().from('devolucoes_fornecedor').select('nota_fiscal_id').eq('id', id).eq('loja_id', ctx.lojaId).maybeSingle()
  atualizar((d as { nota_fiscal_id: number | null } | null)?.nota_fiscal_id)
  return { ok: true }
}
