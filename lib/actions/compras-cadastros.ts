'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { contextoCompras, msgErroCompras, type ErroCompras } from '@/lib/compras/servidor'

// Cadastros de compras do estoque próprio (Fase C2): compradores [I8] e prazo de entrega (lead time) por fornecedor.
// Escrita só por comp_salvar (240) e fornecedor_lead_time_salvar (241), security definer, com o service role.

/** Comprador: nome, usuário do sistema (opcional, para "só as minhas" no painel de tarefas) e situação. Gestor de compras. */
export async function salvarComprador(dados: { id?: number | null; nome: string; userId?: string | null; ativo?: boolean }): Promise<{ id: number } | ErroCompras> {
  const __d = viaDesktop('compras-cadastros#salvarComprador', salvarComprador, [dados]); if (__d) return __d as never
  const ctx = await contextoCompras(['Compras - Aprovar pedidos'])
  if ('error' in ctx) return ctx
  const nome = (dados.nome ?? '').trim()
  if (!nome || nome.length > 70) return { error: 'Nome do comprador: de 1 a 70 caracteres.' }
  if (dados.userId && !/^[0-9a-f-]{36}$/.test(dados.userId)) return { error: 'Usuário inválido.' }
  const { data, error } = await createServiceClient().rpc('comp_salvar', {
    p_loja: ctx.lojaId, p_dados: { id: dados.id ?? null, nome, user_id: dados.userId || null, ativo: dados.ativo ?? true }, p_user: ctx.userId, p_nome: ctx.nome,
  })
  if (error) return { error: msgErroCompras('compras-cadastros', error) }
  const id = (data as { id: number }).id
  await registrarAuditoria(dados.id ? 'editar' : 'criar', 'comprador', id, `Comprador ${nome}${dados.ativo === false ? ' (inativo)' : ''}`)
  revalidatePath('/compras-cadastros')
  return { id }
}

/** Prazo de entrega do fornecedor, em dias (1 a 365); null tira o prazo. Usado pela sugestão quando o produto não tem prazo próprio. */
export async function salvarLeadTimeFornecedor(fornecedorId: number, dias: number | null): Promise<{ ok: true } | ErroCompras> {
  const __d = viaDesktop('compras-cadastros#salvarLeadTimeFornecedor', salvarLeadTimeFornecedor, [fornecedorId, dias]); if (__d) return __d as never
  const ctx = await contextoCompras(['Compras - Pedidos'])
  if ('error' in ctx) return ctx
  if (!Number.isInteger(fornecedorId) || fornecedorId <= 0) return { error: 'Fornecedor inválido.' }
  if (dias != null && (!Number.isInteger(dias) || dias < 1 || dias > 365)) return { error: 'Prazo de entrega entre 1 e 365 dias.' }
  const { error } = await createServiceClient().rpc('fornecedor_lead_time_salvar', { p_loja: ctx.lojaId, p_fornecedor: fornecedorId, p_dias: dias, p_user: ctx.userId })
  if (error) return { error: msgErroCompras('compras-cadastros', error) }
  revalidatePath('/compras-cadastros')
  revalidatePath('/sugestao-compra')
  return { ok: true }
}
