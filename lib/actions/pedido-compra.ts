'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { exigirPeriodoAberto } from '@/lib/estoque/periodo-fechado'
import { agruparPorFornecedor, validarParcelas, type LinhaParaPedido, type Parcela } from '@/lib/compras/pedido-puro'

// Pedido de compra do estoque próprio (Fase C, I2/I3). Só loja modo 'proprio'; nada aqui fala com o Omie.
// Escrita só pelas funções pc_* da migration 200 (security definer), com o service role, depois da permissão.

type Ctx = { lojaId: number; userId: string; nome: string }
type Erro = { error: string }

async function contexto(...permissoes: string[]): Promise<Ctx | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Pedido de compra pelo app só existe na loja de estoque próprio.' }
  for (const p of permissoes) if (!(await requirePermissao(lojaId, p))) return { error: 'Sem permissão' }
  const perfil = await getProfile()
  return { lojaId, userId: perfil.id, nome: perfil.name }
}

// As funções pc_* levantam as regras de negócio com errcode 22023 e mensagem em português; erro técnico não vaza.
const msgErro = (e: { message?: string; code?: string } | null | undefined) => {
  if ((e?.code === '22023' || e?.code === 'PF001') && e.message) return e.message
  console.error('pedido-compra:', e?.message)
  return 'Não foi possível concluir agora. Tente de novo; se continuar, avise o suporte.'
}

function atualizar(id?: number) {
  revalidatePath('/pedido-compra')
  if (id) revalidatePath(`/pedido-compra/${id}`)
  revalidatePath('/sugestao-compra')
}

export type ItemPedidoForm = { codigoProduto: number; descricao?: string; unidade?: string | null; fator?: number; quantidade: number; precoUnitario: number; codigoLocal?: number | null; obs?: string | null }
export type PedidoForm = {
  id?: number | null
  chaveIdempotencia?: string | null
  fornecedorId?: number | null
  fornecedorNome: string
  fornecedorCnpj?: string | null
  previsaoEntrega?: string | null
  frete?: number
  outrasDespesas?: number
  parcelas?: Parcela[]
  numeroFornecedor?: string | null
  contato?: string | null
  obs?: string | null
  obsInterna?: string | null
  /** 240: comprador responsável (cadastro de compradores); sem a 240 o banco ignora o campo */
  compradorId?: number | null
  itens: ItemPedidoForm[]
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const pos = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null)

function validar(f: PedidoForm): string | null {
  if (!f.fornecedorId && !(f.fornecedorNome ?? '').trim()) return 'Informe o fornecedor.'
  if (!f.itens?.length) return 'Inclua pelo menos um item.'
  if (f.itens.length > 300) return 'No máximo 300 itens por pedido.'
  for (const it of f.itens) {
    if (!Number.isFinite(it.codigoProduto)) return 'Item sem produto.'
    if (!pos(it.quantidade)) return 'Quantidade precisa ser maior que zero.'
    if (!(Number.isFinite(it.precoUnitario) && it.precoUnitario >= 0)) return 'Preço inválido.'
    if (it.fator != null && !pos(it.fator)) return 'Fator de conversão precisa ser maior que zero.'
  }
  if (f.previsaoEntrega && !ISO.test(f.previsaoEntrega)) return 'Data de previsão inválida.'
  if ((f.frete ?? 0) < 0 || (f.outrasDespesas ?? 0) < 0) return 'Frete e despesas não podem ser negativos.'
  return validarParcelas(f.parcelas ?? [])
}

function paraJson(f: PedidoForm, origem: 'manual' | 'sugestao') {
  return {
    id: f.id ?? null, chave_idempotencia: f.chaveIdempotencia ?? null, origem,
    fornecedor_id: f.fornecedorId ?? null, fornecedor_nome: (f.fornecedorNome ?? '').trim(), fornecedor_cnpj: f.fornecedorCnpj ?? null,
    previsao_entrega: f.previsaoEntrega || null, frete: f.frete ?? 0, outras_despesas: f.outrasDespesas ?? 0, parcelas: f.parcelas ?? [],
    numero_fornecedor: f.numeroFornecedor ?? null, contato: f.contato ?? null, obs: f.obs ?? null, obs_interna: f.obsInterna ?? null,
    comprador_id: f.compradorId ?? null,
    itens: f.itens.map((i) => ({
      codigo_produto: i.codigoProduto, descricao: i.descricao ?? null, unidade: i.unidade ?? null, fator: i.fator ?? 1,
      quantidade: i.quantidade, preco_unitario: i.precoUnitario, codigo_local_estoque: i.codigoLocal ?? null, obs: i.obs ?? null,
    })),
  }
}

/** Cria ou edita (só rascunho) um pedido de compra. */
export async function salvarPedidoCompra(form: PedidoForm): Promise<{ id: number; numero: number } | Erro> {
  const __d = viaDesktop('pedido-compra#salvarPedidoCompra', salvarPedidoCompra, [form]); if (__d) return __d as never
  const ctx = await contexto('Compras - Pedidos')
  if ('error' in ctx) return ctx
  const inval = validar(form)
  if (inval) return { error: inval }
  // Fase F: pedido criado num mês fechado não muda; previsão de entrega não cai num mês fechado (o banco também recusa).
  let criadoEm: string | null = null
  if (form.id) {
    const { data: p } = await createServiceClient().from('pedidos_compra').select('created_at').eq('id', form.id).eq('loja_id', ctx.lojaId).maybeSingle()
    criadoEm = (p as { created_at: string } | null)?.created_at ?? null
  }
  const travado = (await exigirPeriodoAberto(ctx.lojaId, [criadoEm], 'pedido de compra'))
    ?? (await exigirPeriodoAberto(ctx.lojaId, [form.previsaoEntrega], 'previsão de entrega do pedido'))
  if (travado) return { error: travado }
  const { data, error } = await createServiceClient().rpc('pc_salvar', { p_loja: ctx.lojaId, p_dados: paraJson(form, 'manual'), p_user: ctx.userId, p_nome: ctx.nome })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; numero: number; duplicado: boolean }
  if (!r.duplicado) await registrarAuditoria(form.id ? 'editar' : 'criar', 'pedido_compra', r.id, `Pedido de compra ${r.numero}`)
  atualizar(r.id)
  return { id: r.id, numero: r.numero }
}

export type AcaoEtapa = 'enviar' | 'aprovar' | 'reprovar' | 'reabrir' | 'cancelar'

/** Muda a etapa. Aprovar e reprovar exigem "Compras - Aprovar pedidos"; o resto, "Compras - Pedidos". */
export async function mudarEtapaPedido(id: number, acao: AcaoEtapa, motivo?: string | null): Promise<{ ok: true; etapa: string } | Erro> {
  const __d = viaDesktop('pedido-compra#mudarEtapaPedido', mudarEtapaPedido, [id, acao, motivo]); if (__d) return __d as never
  if (!['enviar', 'aprovar', 'reprovar', 'reabrir', 'cancelar'].includes(acao)) return { error: 'Ação inválida' }
  const ctx = await contexto(acao === 'aprovar' || acao === 'reprovar' ? 'Compras - Aprovar pedidos' : 'Compras - Pedidos')
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('pc_acao', { p_loja: ctx.lojaId, p_id: id, p_acao: acao, p_user: ctx.userId, p_nome: ctx.nome, p_motivo: motivo ?? null })
  if (error) return { error: msgErro(error) }
  await registrarAuditoria(acao === 'aprovar' ? 'concluir' : acao === 'cancelar' ? 'excluir' : 'editar', 'pedido_compra', id, `Pedido de compra: ${acao}`)
  atualizar(id)
  return { ok: true, etapa: (data as { para: string }).para }
}

/** Liga a nota (compra do estoque próprio) a um pedido aprovado; refazer é seguro (refaz os vínculos desta nota). */
export async function vincularNotaAoPedido(pedidoId: number, compraId: number): Promise<{ ok: true; vinculados: number; foraDoPedido: number; emOutroPedido: number } | Erro> {
  const __d = viaDesktop('pedido-compra#vincularNotaAoPedido', vincularNotaAoPedido, [pedidoId, compraId]); if (__d) return __d as never
  const ctx = await contexto('Compras - Pedidos', 'Notas Fiscais')
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('pc_vincular_nota', { p_loja: ctx.lojaId, p_pedido: pedidoId, p_compra: compraId, p_user: ctx.userId, p_nome: ctx.nome })
  if (error) return { error: msgErro(error) }
  const r = data as { vinculados: number; fora_do_pedido: number; em_outro_pedido: number }
  atualizar(pedidoId)
  revalidatePath('/nota-fiscal')
  return { ok: true, vinculados: r.vinculados, foraDoPedido: r.fora_do_pedido, emOutroPedido: r.em_outro_pedido }
}

export async function desvincularNotaDoPedido(pedidoId: number, compraId: number): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('pedido-compra#desvincularNotaDoPedido', desvincularNotaDoPedido, [pedidoId, compraId]); if (__d) return __d as never
  const ctx = await contexto('Compras - Pedidos', 'Notas Fiscais')
  if ('error' in ctx) return ctx
  const { error } = await createServiceClient().rpc('pc_desvincular_nota', { p_loja: ctx.lojaId, p_pedido: pedidoId, p_compra: compraId, p_user: ctx.userId, p_nome: ctx.nome })
  if (error) return { error: msgErro(error) }
  atualizar(pedidoId)
  revalidatePath('/nota-fiscal')
  return { ok: true }
}

/** "Criar pedido" da sugestão: um rascunho por fornecedor (último fornecedor de cada produto). Idempotente pela chave. */
export async function criarPedidosDaSugestao(linhas: LinhaParaPedido[], chave: string): Promise<{ pedidos: { id: number; numero: number; fornecedor: string }[]; falhas: { fornecedor: string; erro: string }[] } | Erro> {
  const __d = viaDesktop('pedido-compra#criarPedidosDaSugestao', criarPedidosDaSugestao, [linhas, chave]); if (__d) return __d as never
  const ctx = await contexto('Compras - Pedidos')
  if ('error' in ctx) return ctx
  if (!/^[0-9a-f-]{16,64}$/i.test(chave)) return { error: 'Chave inválida' }
  const validas = linhas.filter((l) => Number.isFinite(l.codigoProduto) && l.quantidade > 0).slice(0, 300)
  if (!validas.length) return { error: 'Escolha pelo menos um produto com quantidade.' }
  const grupos = agruparPorFornecedor(validas)
  const sb = createServiceClient()
  const pedidos: { id: number; numero: number; fornecedor: string }[] = []
  const falhas: { fornecedor: string; erro: string }[] = []
  for (const [i, g] of grupos.entries()) {
    const nome = g.fornecedorNome ?? 'Fornecedor a definir'
    const form: PedidoForm = {
      chaveIdempotencia: `${chave}:${i}`, fornecedorId: g.fornecedorId, fornecedorNome: nome, fornecedorCnpj: g.fornecedorCnpj,
      itens: g.itens.map((l) => ({ codigoProduto: l.codigoProduto, quantidade: Math.round(l.quantidade * 1e6) / 1e6, precoUnitario: Math.max(0, Math.round((l.preco || 0) * 1e6) / 1e6) })),
    }
    const { data, error } = await sb.rpc('pc_salvar', { p_loja: ctx.lojaId, p_dados: paraJson(form, 'sugestao'), p_user: ctx.userId, p_nome: ctx.nome })
    // segue para os outros fornecedores e devolve quais falharam (a mesma chave refaz só o que faltou)
    if (error) { falhas.push({ fornecedor: nome, erro: msgErro(error) }); continue }
    const r = data as { id: number; numero: number; duplicado: boolean }
    if (!r.duplicado) await registrarAuditoria('criar', 'pedido_compra', r.id, `Pedido de compra ${r.numero} (da sugestão)`)
    pedidos.push({ id: r.id, numero: r.numero, fornecedor: nome })
  }
  atualizar()
  if (!pedidos.length) return { error: falhas.map((f) => `${f.fornecedor}: ${f.erro}`).join(' · ') || 'Nenhum pedido criado.' }
  return { pedidos, falhas }
}

/** Lead time de ressuprimento do produto (estoque próprio; na loja Omie ele vem do cadastro do Omie). */
export async function salvarLeadTime(codigoProduto: number, dias: number): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('pedido-compra#salvarLeadTime', salvarLeadTime, [codigoProduto, dias]); if (__d) return __d as never
  const ctx = await contexto('Compras - Pedidos')
  if ('error' in ctx) return ctx
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) return { error: 'Lead time entre 1 e 365 dias.' }
  const { error } = await createServiceClient().from('produto_compra_param')
    .upsert({ loja_id: ctx.lojaId, codigo_produto: codigoProduto, lead_time_dias: dias, updated_by: ctx.userId, updated_at: new Date().toISOString() }, { onConflict: 'loja_id,codigo_produto' })
  if (error) return { error: 'Não foi possível salvar o lead time.' }
  revalidatePath('/sugestao-compra')
  return { ok: true }
}
