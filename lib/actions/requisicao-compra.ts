'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { contextoCompras, msgErroCompras, type ErroCompras } from '@/lib/compras/servidor'
import type { LinhaParaPedido } from '@/lib/compras/pedido-puro'
import { exigirDevAcao } from '@/lib/recursos-dev'

// Requisição de compra do estoque próprio (Fase C2, I1). Escrita só pelas funções rc_* da migration 240 (security
// definer), com o service role, depois da permissão. Nada aqui fala com o Omie.
//   criar/editar = "Compras - Requisicoes"; aprovar/recusar = "Compras - Aprovar pedidos"; gerar pedido = "Compras - Pedidos".

export type ItemRequisicaoForm = {
  codigoProduto: number; descricao?: string | null; unidade?: string | null; fator?: number; quantidade: number; precoSugerido: number
  fornecedorId?: number | null; fornecedorNome?: string | null; fornecedorCnpj?: string | null; obs?: string | null
}
export type RequisicaoForm = {
  id?: number | null; chaveIdempotencia?: string | null; sugestaoEntrega?: string | null; compradorId?: number | null
  obs?: string | null; obsInterna?: string | null; itens: ItemRequisicaoForm[]
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const CHAVE = /^[A-Za-z0-9_-]{8,80}$/
const pos = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0

function validar(f: RequisicaoForm): string | null {
  if (!f.itens?.length) return 'Inclua pelo menos um item.'
  if (f.itens.length > 300) return 'No máximo 300 itens por requisição.'
  for (const it of f.itens) {
    if (!Number.isFinite(it.codigoProduto)) return 'Item sem produto.'
    if (!pos(it.quantidade)) return 'Quantidade precisa ser maior que zero.'
    if (!(Number.isFinite(it.precoSugerido) && it.precoSugerido >= 0)) return 'Preço sugerido inválido.'
    if (it.fator != null && !pos(it.fator)) return 'Fator de conversão precisa ser maior que zero.'
  }
  if (f.sugestaoEntrega && !ISO.test(f.sugestaoEntrega)) return 'Data de entrega inválida.'
  if (f.chaveIdempotencia && !CHAVE.test(f.chaveIdempotencia)) return 'Chave inválida.'
  return null
}

function paraJson(f: RequisicaoForm, origem: 'manual' | 'sugestao') {
  return {
    id: f.id ?? null, chave_idempotencia: f.chaveIdempotencia ?? null, origem, sugestao_entrega: f.sugestaoEntrega || null,
    comprador_id: f.compradorId ?? null, obs: f.obs ?? null, obs_interna: f.obsInterna ?? null,
    itens: f.itens.map((i) => ({
      codigo_produto: i.codigoProduto, descricao: i.descricao ?? null, unidade: i.unidade ?? null, fator: i.fator ?? 1, quantidade: i.quantidade,
      preco_sugerido: i.precoSugerido, fornecedor_id: i.fornecedorId ?? null, fornecedor_nome: i.fornecedorNome ?? null,
      fornecedor_cnpj: i.fornecedorCnpj ?? null, obs: i.obs ?? null,
    })),
  }
}

function atualizar(id?: number) {
  revalidatePath('/requisicao-compra')
  if (id) revalidatePath(`/requisicao-compra/${id}`)
  revalidatePath('/tarefas-compras')
  revalidatePath('/sugestao-compra')
}

/** Cria ou edita (só aberta) uma requisição de compra. */
export async function salvarRequisicao(form: RequisicaoForm): Promise<{ id: number; numero: number } | ErroCompras> {
  const __d = viaDesktop('requisicao-compra#salvarRequisicao', salvarRequisicao, [form]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contextoCompras(['Compras - Requisicoes'])
  if ('error' in ctx) return ctx
  const inval = validar(form)
  if (inval) return { error: inval }
  const { data, error } = await createServiceClient().rpc('rc_salvar', { p_loja: ctx.lojaId, p_dados: paraJson(form, 'manual'), p_user: ctx.userId, p_nome: ctx.nome })
  if (error) return { error: msgErroCompras('requisicao-compra', error) }
  const r = data as { id: number; numero: number; duplicado: boolean }
  if (!r.duplicado) await registrarAuditoria(form.id ? 'editar' : 'criar', 'requisicao_compra', r.id, `Requisição de compra ${r.numero}`)
  atualizar(r.id)
  return { id: r.id, numero: r.numero }
}

export type AcaoRequisicaoServidor = 'aprovar' | 'recusar' | 'reabrir'

/** Aprovar e recusar exigem "Compras - Aprovar pedidos"; reabrir, quem cria requisição ou quem aprova. */
export async function acaoRequisicao(id: number, acao: AcaoRequisicaoServidor, motivo?: string | null): Promise<{ ok: true; etapa: string } | ErroCompras> {
  const __d = viaDesktop('requisicao-compra#acaoRequisicao', acaoRequisicao, [id, acao, motivo]); if (__d) return __d as never
  await exigirDevAcao()
  if (!['aprovar', 'recusar', 'reabrir'].includes(acao)) return { error: 'Ação inválida' }
  const ctx = acao === 'reabrir'
    ? await contextoCompras(['Compras - Requisicoes', 'Compras - Aprovar pedidos'], 'alguma')
    : await contextoCompras(['Compras - Aprovar pedidos'])
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('rc_acao', { p_loja: ctx.lojaId, p_id: id, p_acao: acao, p_user: ctx.userId, p_nome: ctx.nome, p_motivo: motivo ?? null })
  if (error) return { error: msgErroCompras('requisicao-compra', error) }
  await registrarAuditoria(acao === 'aprovar' ? 'concluir' : 'editar', 'requisicao_compra', id, `Requisição de compra: ${acao}`)
  atualizar(id)
  return { ok: true, etapa: (data as { para: string }).para }
}

/** Um pedido rascunho por fornecedor, a partir de requisições aprovadas. Tudo ou nada; repetir a chave devolve os mesmos pedidos. */
export async function gerarPedidosDasRequisicoes(ids: number[], chave: string): Promise<{ pedidos: { id: number; numero: number; fornecedor: string }[]; duplicado: boolean } | ErroCompras> {
  const __d = viaDesktop('requisicao-compra#gerarPedidosDasRequisicoes', gerarPedidosDasRequisicoes, [ids, chave]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contextoCompras(['Compras - Pedidos'])
  if ('error' in ctx) return ctx
  if (!CHAVE.test(chave)) return { error: 'Chave inválida' }
  const validos = [...new Set(ids.filter((x) => Number.isInteger(x) && x > 0))]
  if (!validos.length) return { error: 'Escolha pelo menos uma requisição aprovada.' }
  if (validos.length > 100) return { error: 'No máximo 100 requisições de uma vez.' }
  const { data, error } = await createServiceClient().rpc('rc_gerar_pedidos', { p_loja: ctx.lojaId, p_ids: validos, p_chave: chave, p_user: ctx.userId, p_nome: ctx.nome })
  if (error) return { error: msgErroCompras('requisicao-compra', error) }
  const r = data as { duplicado: boolean; pedidos: { id: number; numero: number; fornecedor: string }[] }
  if (!r.duplicado) for (const p of r.pedidos) await registrarAuditoria('criar', 'pedido_compra', p.id, `Pedido de compra ${p.numero} (das requisições)`)
  atualizar()
  revalidatePath('/pedido-compra')
  return { pedidos: r.pedidos, duplicado: r.duplicado }
}

/** "Criar requisição" na sugestão: uma requisição com os itens marcados (fornecedor da última nota sugerido por item). */
export async function criarRequisicaoDaSugestao(linhas: LinhaParaPedido[], chave: string): Promise<{ id: number; numero: number } | ErroCompras> {
  const __d = viaDesktop('requisicao-compra#criarRequisicaoDaSugestao', criarRequisicaoDaSugestao, [linhas, chave]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contextoCompras(['Compras - Requisicoes'])
  if ('error' in ctx) return ctx
  if (!CHAVE.test(chave)) return { error: 'Chave inválida' }
  const validas = linhas.filter((l) => Number.isFinite(l.codigoProduto) && l.quantidade > 0).slice(0, 300)
  if (!validas.length) return { error: 'Escolha pelo menos um produto com quantidade.' }
  const form: RequisicaoForm = {
    chaveIdempotencia: chave,
    itens: validas.map((l) => ({
      codigoProduto: l.codigoProduto, quantidade: Math.round(l.quantidade * 1e6) / 1e6, precoSugerido: Math.max(0, Math.round((l.preco || 0) * 1e6) / 1e6),
      fornecedorId: l.fornecedorId, fornecedorNome: l.fornecedorNome, fornecedorCnpj: l.fornecedorCnpj,
    })),
  }
  const { data, error } = await createServiceClient().rpc('rc_salvar', { p_loja: ctx.lojaId, p_dados: paraJson(form, 'sugestao'), p_user: ctx.userId, p_nome: ctx.nome })
  if (error) return { error: msgErroCompras('requisicao-compra', error) }
  const r = data as { id: number; numero: number; duplicado: boolean }
  if (!r.duplicado) await registrarAuditoria('criar', 'requisicao_compra', r.id, `Requisição de compra ${r.numero} (da sugestão)`)
  atualizar(r.id)
  return { id: r.id, numero: r.numero }
}
