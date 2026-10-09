'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { lerQuantidade } from '@/lib/estoque/inventario-regras'

type Erro = { error: string }

/** Tudo aqui só vale para loja em modo "proprio". Abrir e contar: Inventarios - Criar; revisar e fechar: Inventarios - Editar. */
async function contexto(permissao: string): Promise<{ lojaId: number; userId: string | null } | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa o estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const user = await getUser()
  return { lojaId, userId: user?.id ?? null }
}

async function inventarioDaLoja(lojaId: number, id: number): Promise<{ id: number; status: string; local: number } | null> {
  const { data } = await createServiceClient()
    .from('inventarios_proprio').select('id, status, codigo_local_estoque').eq('id', id).eq('loja_id', lojaId).maybeSingle()
  return data ? { id: Number(data.id), status: String(data.status), local: Number(data.codigo_local_estoque) } : null
}

function atualizar(id?: number) {
  revalidatePath('/inventario-proprio')
  revalidatePath('/estoque')
  if (id) {
    revalidatePath(`/inventario-proprio/${id}/contar`)
    revalidatePath(`/inventario-proprio/${id}/revisar`)
  }
}

function mensagem(e: unknown, padrao: string): string {
  const m = e instanceof Error ? e.message : (e as { message?: string } | null)?.message
  return m || padrao
}

export async function abrirInventario(dados: {
  codigoLocal: number
  tipo: 'geral' | 'ciclica'
  classe?: 'A' | 'B' | 'C' | null
  descricao?: string
}): Promise<{ ok: true; id: number; itens: number } | Erro> {
  const __d = viaDesktop('inventario-proprio#abrirInventario', abrirInventario, [dados]); if (__d) return __d as never
  const ctx = await contexto('Inventarios - Criar')
  if ('error' in ctx) return ctx
  if (dados.tipo === 'ciclica' && !dados.classe) return { error: 'Escolha a curva (A, B ou C) da contagem cíclica.' }
  const { data, error } = await createServiceClient().rpc('abrir_inventario', {
    p_loja: ctx.lojaId, p_local: dados.codigoLocal, p_user: ctx.userId, p_tipo: dados.tipo,
    p_classe: dados.tipo === 'ciclica' ? dados.classe : null, p_descricao: dados.descricao?.trim() || null,
  })
  if (error) return { error: error.message }
  const r = data as { id: number; itens: number }
  await registrarAuditoria('criar', 'contagem de estoque', r.id, dados.descricao?.trim() || `Local ${dados.codigoLocal}`)
  atualizar()
  return { ok: true, id: Number(r.id), itens: Number(r.itens) }
}

/** Grava a quantidade contada. NUNCA devolve o saldo do sistema (contagem cega). */
export async function contarItem(dados: { inventarioId: number; codigoProduto: number; contado: number | string }): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('inventario-proprio#contarItem', contarItem, [dados]); if (__d) return __d as never
  const ctx = await contexto('Inventarios - Criar')
  if ('error' in ctx) return ctx
  const inv = await inventarioDaLoja(ctx.lojaId, dados.inventarioId)
  if (!inv) return { error: 'Contagem não encontrada.' }
  if (inv.status !== 'aberto') return { error: 'Esta contagem já foi encerrada.' }
  const qtd = lerQuantidade(dados.contado)
  if (qtd == null) return { error: 'Informe uma quantidade válida (zero ou mais).' }
  const { error } = await createServiceClient().rpc('contar_item', {
    p_inventario: dados.inventarioId, p_produto: dados.codigoProduto, p_contado: qtd, p_user: ctx.userId, p_motivo: null, p_em: null,
  })
  if (error) return { error: error.message }
  return { ok: true }
}

export async function definirMotivoItem(dados: { inventarioId: number; codigoProduto: number; motivo: string }): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('inventario-proprio#definirMotivoItem', definirMotivoItem, [dados]); if (__d) return __d as never
  const ctx = await contexto('Inventarios - Editar')
  if ('error' in ctx) return ctx
  if (!(await inventarioDaLoja(ctx.lojaId, dados.inventarioId))) return { error: 'Contagem não encontrada.' }
  const { error } = await createServiceClient().rpc('motivo_item_inventario', {
    p_inventario: dados.inventarioId, p_produto: dados.codigoProduto, p_motivo: dados.motivo,
  })
  if (error) return { error: error.message }
  return { ok: true }
}

export async function fecharInventario(inventarioId: number): Promise<{ ok: true; ajustes: number; valor: number; duplicado: boolean } | Erro> {
  const __d = viaDesktop('inventario-proprio#fecharInventario', fecharInventario, [inventarioId]); if (__d) return __d as never
  const ctx = await contexto('Inventarios - Editar')
  if ('error' in ctx) return ctx
  if (!(await inventarioDaLoja(ctx.lojaId, inventarioId))) return { error: 'Contagem não encontrada.' }
  const { data, error } = await createServiceClient().rpc('fechar_inventario', { p_inventario: inventarioId, p_user: ctx.userId })
  if (error) return { error: mensagem(error, 'Não foi possível fechar a contagem.') }
  const r = data as { ajustes?: number; valor_ajustes?: number; duplicado?: boolean }
  await registrarAuditoria('editar', 'fechamento de contagem de estoque', inventarioId, `${r.ajustes ?? 0} ajuste(s)`)
  atualizar(inventarioId)
  return { ok: true, ajustes: Number(r.ajustes ?? 0), valor: Number(r.valor_ajustes ?? 0), duplicado: !!r.duplicado }
}

export async function cancelarInventario(inventarioId: number): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('inventario-proprio#cancelarInventario', cancelarInventario, [inventarioId]); if (__d) return __d as never
  const ctx = await contexto('Inventarios - Editar')
  if ('error' in ctx) return ctx
  if (!(await inventarioDaLoja(ctx.lojaId, inventarioId))) return { error: 'Contagem não encontrada.' }
  const { error } = await createServiceClient().rpc('cancelar_inventario', { p_inventario: inventarioId, p_user: ctx.userId })
  if (error) return { error: error.message }
  await registrarAuditoria('excluir', 'contagem de estoque', inventarioId, 'cancelada')
  atualizar(inventarioId)
  return { ok: true }
}

export type ProdutoBusca = { codigoProduto: number; codigo: string; descricao: string; unidade: string }

/** Busca para "achei um item que não está na lista". Sem saldo, de propósito. */
export async function buscarProdutosParaContagem(termo: string): Promise<ProdutoBusca[] | Erro> {
  const __d = viaDesktop('inventario-proprio#buscarProdutosParaContagem', buscarProdutosParaContagem, [termo]); if (__d) return __d as never
  const ctx = await contexto('Inventarios - Criar')
  if ('error' in ctx) return ctx
  const t = termo.trim().replace(/[%,()]/g, ' ')
  if (t.length < 2) return []
  const { data } = await createServiceClient()
    .from('produtos').select('codigo_produto, codigo, descricao, unidade')
    .eq('loja_id', ctx.lojaId).neq('inativo', true)
    .or(`descricao.ilike.%${t}%,codigo.ilike.%${t}%`).order('descricao').limit(20)
  return (data ?? []).map((p) => ({
    codigoProduto: Number(p.codigo_produto), codigo: p.codigo ?? String(p.codigo_produto), descricao: p.descricao ?? '', unidade: p.unidade ?? 'UN',
  }))
}

export async function salvarLimiteMotivo(valor: number | string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('inventario-proprio#salvarLimiteMotivo', salvarLimiteMotivo, [valor]); if (__d) return __d as never
  const ctx = await contexto('Inventarios - Editar')
  if ('error' in ctx) return ctx
  const n = lerQuantidade(valor)
  if (n == null) return { error: 'Informe um valor em reais (zero ou mais).' }
  const { error } = await createServiceClient().from('estoque_config').upsert(
    { loja_id: ctx.lojaId, limite_motivo_inventario: n, updated_at: new Date().toISOString() }, { onConflict: 'loja_id' })
  if (error) return { error: error.message }
  await registrarAuditoria('editar', 'limite de motivo da contagem', ctx.lojaId, String(n))
  atualizar()
  return { ok: true }
}
