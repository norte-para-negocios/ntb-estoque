'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { criarProdutoProprio } from '@/lib/estoque/proprio-driver'
import { espelharNotaNoFrio } from '@/lib/estoque/nf-frio'
import { localPadraoEntrada } from '@/lib/estoque/nf-sefaz'
import { sincronizarSefaz } from '@/lib/estoque/sefaz-sync'

// Ações da tela de Notas Fiscais em loja de estoque próprio (sem Omie): conferir itens, confirmar a entrada, desfazer e excluir.

type Ctx = { lojaId: number; userId: string | null }

async function contexto(permissao: string): Promise<Ctx | { error: string }> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa o estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const user = await getUser()
  return { lojaId, userId: user?.id ?? null }
}

async function atualizarSituacao(lojaId: number, notaId: number) {
  await createServiceClient().rpc('sincronizar_situacao_nota', { p_loja: lojaId, p_nota: notaId })
  void espelharNotaNoFrio(lojaId, notaId)
  revalidatePath(`/nota-fiscal/${notaId}`)
  revalidatePath('/nota-fiscal')
  revalidatePath('/estoque')
}

async function compraDaNota(lojaId: number, notaId: number) {
  const { data } = await createServiceClient().from('compras_proprio').select('id, status, numero, codigo_local_estoque').eq('loja_id', lojaId).eq('nota_fiscal_id', notaId).maybeSingle()
  return data
}

/** 'Confirmar entrada': lança no estoque os itens já ligados a produto (os demais ficam pendentes e a nota fica parcial). */
export async function confirmarEntradaNF(notaId: number, codigoLocal?: number | null): Promise<{ ok: true; lancados: number; pendentes: number; status: string } | { error: string }> {
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (!compra) return { error: 'Esta nota ainda não tem itens para conferir (só o resumo chegou da SEFAZ).' }
  if (compra.status === 'cancelada') return { error: 'A entrada desta nota foi desfeita. Não dá para lançar de novo.' }
  const local = codigoLocal ?? (compra.codigo_local_estoque != null ? Number(compra.codigo_local_estoque) : await localPadraoEntrada(ctx.lojaId))
  if (!local) return { error: 'Cadastre um local de estoque para receber a mercadoria.' }
  const { data, error } = await createServiceClient().rpc('lancar_compra', { p_compra: { loja_id: ctx.lojaId, id: compra.id, itens: [] }, p_local: local, p_user: ctx.userId })
  if (error) return { error: error.message }
  const r = data as { status: string; lancados: number; pendentes: number }
  await registrarAuditoria('concluir', 'nota fiscal (entrada)', compra.numero ?? notaId, null)
  await atualizarSituacao(ctx.lojaId, notaId)
  return { ok: true, lancados: Number(r.lancados) || 0, pendentes: Number(r.pendentes) || 0, status: r.status }
}

/** Desfaz a entrada no estoque (estorno movimento a movimento; o histórico fica). */
export async function desfazerEntradaNF(notaId: number): Promise<{ ok: true; estornados: number } | { error: string }> {
  const ctx = await contexto('Notas Fiscais - Reverter')
  if ('error' in ctx) return ctx
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (!compra) return { error: 'Esta nota não tem entrada lançada.' }
  const { data, error } = await createServiceClient().rpc('estornar_compra', { p_compra_id: compra.id, p_user: ctx.userId })
  if (error) return { error: error.message }
  await registrarAuditoria('reverter', 'nota fiscal (entrada)', compra.numero ?? notaId, null)
  await atualizarSituacao(ctx.lojaId, notaId)
  return { ok: true, estornados: Number((data as { estornados: number }).estornados) || 0 }
}

/** Tira a nota da lista (soft delete). Se já tinha entrada no estoque, a entrada é desfeita antes. */
export async function excluirNotaProprio(notaId: number): Promise<{ ok: true } | { error: string }> {
  const ctx = await contexto('Notas Fiscais - Excluir')
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (compra && compra.status !== 'cancelada') {
    const { error } = await sb.rpc('estornar_compra', { p_compra_id: compra.id, p_user: ctx.userId })
    if (error) return { error: error.message }
  }
  const { error: ed } = await sb.from('notas_fiscais').update({ deleted_at: new Date().toISOString() }).eq('id', notaId).eq('loja_id', ctx.lojaId)
  if (ed) return { error: ed.message }
  await registrarAuditoria('excluir', 'nota fiscal', notaId, null)
  void espelharNotaNoFrio(ctx.lojaId, notaId)
  revalidatePath('/nota-fiscal')
  return { ok: true }
}

/** Liga um item da nota a um produto do cadastro (e o sistema aprende o de-para para as próximas notas do fornecedor). */
export async function vincularItemNF(compraItemId: number, codigoProduto: number, fator: number): Promise<{ ok: true } | { error: string }> {
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('vincular_item_compra', { p_loja: ctx.lojaId, p_compra_item: compraItemId, p_produto: codigoProduto, p_fator: fator > 0 ? fator : 1, p_user: ctx.userId })
  if (error) return { error: error.message }
  const notaId = (data as { nota_id: number | null }).nota_id
  if (notaId) await atualizarSituacao(ctx.lojaId, Number(notaId))
  return { ok: true }
}

/** Cria o produto a partir do item da nota (descrição, unidade e NCM da nota; código por tipo) e já liga o item a ele. */
export async function criarProdutoDoItemNF(compraItemId: number, tipoItem: string): Promise<{ ok: true; codigo: string } | { error: string }> {
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  if (!(await requirePermissao(ctx.lojaId, 'Produtos - Criar'))) return { error: 'Sem permissão para criar produto' }
  const sb = createServiceClient()
  const { data: it } = await sb.from('compras_proprio_itens').select('id, descricao, unidade_compra, ncm, lancado').eq('id', compraItemId).eq('loja_id', ctx.lojaId).maybeSingle()
  if (!it) return { error: 'Item não encontrado.' }
  if (it.lancado) return { error: 'Item já lançado no estoque.' }
  const r = await criarProdutoProprio(ctx.lojaId, { descricao: it.descricao ?? 'Produto da nota', unidade: it.unidade_compra || 'UN', tipoItem, ncm: it.ncm && /^\d{8}$/.test(it.ncm) ? it.ncm : null })
  if ('error' in r) return r
  await registrarAuditoria('criar', 'produto', r.codigoProduto, it.descricao ?? null)
  const v = await vincularItemNF(compraItemId, r.codigoProduto, 1)
  if ('error' in v) return v
  return { ok: true, codigo: r.codigo }
}

export type ProdutoNF = { codigoProduto: number; codigo: string; descricao: string; unidade: string }
export async function buscarProdutosNF(termo: string): Promise<ProdutoNF[]> {
  const ctx = await contexto('Notas Fiscais')
  if ('error' in ctx) return []
  const q = termo.trim().replace(/[%,()]/g, ' ')
  if (q.length < 2) return []
  const { data } = await createServiceClient().from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', ctx.lojaId).neq('inativo', true)
    .or(`descricao.ilike.%${q}%,codigo.ilike.${q}%`).order('descricao').limit(15)
  return (data ?? []).map((p) => ({ codigoProduto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao, unidade: p.unidade }))
}

/** Liga/desliga a entrada automática e a ciência da operação para esta loja. */
export async function salvarConfigSefaz(cfg: { autoLancar: boolean; autoCiencia: boolean; ativo: boolean; ambiente: 1 | 2 }): Promise<{ ok: true } | { error: string }> {
  const ctx = await contexto('Notas Fiscais - Sincronizar')
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  const { data: loja } = await sb.from('lojas').select('cnpj').eq('id', ctx.lojaId).maybeSingle()
  const { error } = await sb.from('sefaz_nsu').upsert({ loja_id: ctx.lojaId, cnpj: String(loja?.cnpj ?? '').replace(/\D/g, '') || null, auto_lancar: cfg.autoLancar, auto_ciencia: cfg.autoCiencia, ativo: cfg.ativo, ambiente: cfg.ambiente, updated_at: new Date().toISOString() }, { onConflict: 'loja_id' })
  if (error) return { error: error.message }
  revalidatePath('/nota-fiscal')
  return { ok: true }
}

export async function sincronizarSefazAgora() {
  const ctx = await contexto('Notas Fiscais - Sincronizar')
  if ('error' in ctx) return ctx
  const r = await sincronizarSefaz(ctx.lojaId)
  revalidatePath('/nota-fiscal')
  return r
}

/** Cria um produto pela conferência da nota (código por tipo). Mesmo formato do criar rápido das compras, com as permissões de Notas Fiscais. */
export async function criarProdutoParaNF(dados: { descricao: string; unidade: string; tipoItem: string; ncm?: string | null }): Promise<{ ok: true; produto: ProdutoNF } | { error: string }> {
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  if (!(await requirePermissao(ctx.lojaId, 'Produtos - Criar'))) return { error: 'Sem permissão para criar produto' }
  const r = await criarProdutoProprio(ctx.lojaId, { descricao: dados.descricao, unidade: dados.unidade, tipoItem: dados.tipoItem, ncm: dados.ncm ?? null })
  if ('error' in r) return r
  await registrarAuditoria('criar', 'produto', r.codigoProduto, dados.descricao.trim())
  return { ok: true, produto: { codigoProduto: r.codigoProduto, codigo: r.codigo, descricao: dados.descricao.trim(), unidade: dados.unidade.trim() } }
}
