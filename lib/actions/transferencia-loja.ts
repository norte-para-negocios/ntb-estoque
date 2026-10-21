'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { exigirDevAcao } from '@/lib/recursos-dev'

// Fase F [F2/H4]: transferência/remessa ENTRE LOJAS com nota (só estoque próprio). Escrita só pelas funções da migration
// 261 (security definer, só service role), depois da permissão. As unidades saem do estoque na hora, ao custo médio;
// a NF-e sai pelo painel da transferência (lib/actions/nfe-saida.ts). Precisa de internet (fora da política offline).

type Erro = { error: string }
const PERMISSAO = 'Transferencias - Entre lojas'

async function contexto(): Promise<{ lojaId: number; userId: string; nome: string } | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Transferência entre lojas com nota só existe na loja de estoque próprio.' }
  if (!(await requirePermissao(lojaId, PERMISSAO))) return { error: 'Sem permissão' }
  const p = await getProfile()
  return { lojaId, userId: p.id, nome: p.name }
}

const msgErro = (e: { message?: string; code?: string } | null | undefined) => {
  if ((e?.code === '22023' || e?.code === 'PF001') && e.message) return e.message
  if (/transferencia_loja/.test(e?.message ?? '')) return 'A transferência entre lojas ainda não foi ativada nesta instalação (migration 261).'
  console.error('transferencia-loja:', e?.message)
  return 'Não foi possível concluir agora. Tente de novo; se continuar, avise o suporte.'
}

export type ItemTransferenciaLoja = { codigoProduto: number; codigoLocal: number; quantidade: number }

export async function registrarTransferenciaLoja(input: { destino: number; itens: ItemTransferenciaLoja[]; obs?: string; chave: string }): Promise<{ ok: true; id: number; numero: number } | Erro> {
  const __d = viaDesktop('transferencia-loja#registrarTransferenciaLoja', registrarTransferenciaLoja, [input]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  const itens = (input.itens ?? []).filter((i) => Number(i.quantidade) > 0)
  if (!itens.length) return { error: 'Escolha pelo menos um item com quantidade.' }
  if (!Number(input.destino)) return { error: 'Escolha a loja de destino.' }
  const { data, error } = await createServiceClient().rpc('transferencia_loja_registrar', {
    p_loja: ctx.lojaId, p_destino: Number(input.destino), p_obs: (input.obs ?? '').trim() || null, p_user: ctx.userId, p_user_nome: ctx.nome,
    p_chave: input.chave || null,
    p_itens: itens.map((i) => ({ codigo_produto: Number(i.codigoProduto), codigo_local_estoque: Number(i.codigoLocal), quantidade: Number(i.quantidade) })),
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; numero: number; duplicado: boolean }
  if (!r.duplicado) await registrarAuditoria('criar', 'transferência entre lojas', r.id, `Transferência nº ${r.numero}`)
  revalidatePath('/transferencia-loja')
  revalidatePath('/estoque')
  return { ok: true, id: r.id, numero: r.numero }
}

export async function cancelarTransferenciaLoja(id: number, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('transferencia-loja#cancelarTransferenciaLoja', cancelarTransferenciaLoja, [id, motivo]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  if ((motivo ?? '').trim().length < 3) return { error: 'Informe o motivo do cancelamento.' }
  const { error } = await createServiceClient().rpc('transferencia_loja_cancelar', { p_loja: ctx.lojaId, p_id: Number(id), p_user: ctx.userId, p_user_nome: ctx.nome, p_motivo: motivo.trim() })
  if (error) return { error: msgErro(error) }
  await registrarAuditoria('cancelar', 'transferência entre lojas', id, motivo.trim())
  revalidatePath('/transferencia-loja')
  revalidatePath('/estoque')
  return { ok: true }
}
