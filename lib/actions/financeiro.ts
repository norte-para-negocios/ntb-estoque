'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { PERM } from '@/lib/financeiro/dados'
import { calcularPagamento, paraCentavos } from '@/lib/financeiro/titulo-puro'

// Finanças, etapa 1 (migrations 285/286): contas correntes, categorias, contas a pagar e registro de pagamento.
// Só desenvolvedores, só loja de estoque próprio, sempre depois da permissão. Escrita só pelas funções SQL (security definer,
// só service role): cada uma é uma transação com trava no título e chave de idempotência. NENHUMA chamada ao Omie nem a banco:
// pagar é só registrar. Precisa de internet (fora da política offline do desktop, lib/offline/politica.ts).

type Erro = { error: string }
type Ctx = { lojaId: number; userId: string; nome: string }

async function contexto(permissao: string): Promise<Ctx | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'O financeiro do Norte só existe na loja de estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const p = await getProfile()
  return { lojaId, userId: p.id, nome: p.name }
}

const msgErro = (e: { message?: string; code?: string } | null | undefined) => {
  if ((e?.code === '22023' || e?.code === 'PF001') && e.message) return e.message
  if (/fin_/.test(e?.message ?? '')) return 'O financeiro ainda não foi ativado nesta instalação (migrations 285 e 286).'
  console.error('financeiro:', e?.message)
  return 'Não foi possível concluir agora. Tente de novo; se continuar, avise o suporte.'
}

const num = (v: unknown): number => { const c = paraCentavos(v as number | string); return Number.isNaN(c) ? NaN : c / 100 }
const texto = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)
const dataISO = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : '')

function atualizar() {
  revalidatePath('/financeiro/contas-pagar')
  revalidatePath('/financeiro/contas-correntes')
  revalidatePath('/financeiro/extrato')
  revalidatePath('/financeiro/categorias')
}

// ------------------------------------------------------------------------------------------------ contas correntes
export type ContaInput = {
  id?: number | null; nome: string; tipo: 'caixa' | 'banco' | 'outro'; banco?: string; agencia?: string; numeroConta?: string
  saldoInicial: number | string; dataSaldoInicial?: string; ativa?: boolean; observacao?: string
}

export async function salvarContaCorrente(input: ContaInput): Promise<{ ok: true; id: number } | Erro> {
  const __d = viaDesktop('financeiro#salvarContaCorrente', salvarContaCorrente, [input]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasCorrentes)
  if ('error' in ctx) return ctx
  const saldo = num(input.saldoInicial === '' ? 0 : input.saldoInicial)
  if (Number.isNaN(saldo)) return { error: 'Saldo inicial inválido.' }
  const { data, error } = await createServiceClient().rpc('fin_conta_salvar', {
    p_loja: ctx.lojaId, p_id: input.id ?? null, p_user: ctx.userId, p_user_nome: ctx.nome,
    p_dados: {
      nome: texto(input.nome, 80), tipo: input.tipo, banco: texto(input.banco, 80), agencia: texto(input.agencia, 20), numero_conta: texto(input.numeroConta, 30),
      saldo_inicial: saldo, data_saldo_inicial: dataISO(input.dataSaldoInicial) || null, ativa: input.ativa ?? true, observacao: texto(input.observacao),
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; criada: boolean }
  await registrarAuditoria(r.criada ? 'criar' : 'editar', 'conta corrente', r.id, texto(input.nome, 80))
  atualizar()
  return { ok: true, id: r.id }
}

// ----------------------------------------------------------------------------------------------------- categorias
export type CategoriaInput = {
  id?: number | null; codigo?: string; nome: string; tipo: 'despesa' | 'receita'; grupoDre: string; categoriaContabilId?: number | null; ativa?: boolean
}

export async function salvarCategoriaFinanceira(input: CategoriaInput): Promise<{ ok: true; id: number } | Erro> {
  const __d = viaDesktop('financeiro#salvarCategoriaFinanceira', salvarCategoriaFinanceira, [input]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.categorias)
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('fin_categoria_salvar', {
    p_loja: ctx.lojaId, p_id: input.id ?? null, p_user: ctx.userId, p_user_nome: ctx.nome,
    p_dados: {
      codigo: texto(input.codigo, 20), nome: texto(input.nome, 80), tipo: input.tipo, grupo_dre: input.grupoDre,
      categoria_contabil_id: input.categoriaContabilId ?? null, ativa: input.ativa ?? true,
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; criada: boolean }
  await registrarAuditoria(r.criada ? 'criar' : 'editar', 'categoria financeira', r.id, texto(input.nome, 80))
  atualizar()
  return { ok: true, id: r.id }
}

export async function criarCategoriasPadrao(): Promise<{ ok: true; criadas: number } | Erro> {
  const __d = viaDesktop('financeiro#criarCategoriasPadrao', criarCategoriasPadrao, []); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.categorias)
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('fin_categorias_semear', { p_loja: ctx.lojaId })
  if (error) return { error: msgErro(error) }
  const criadas = Number(data ?? 0)
  if (criadas > 0) await registrarAuditoria('criar', 'categoria financeira', null, `${criadas} categorias padrão`)
  atualizar()
  return { ok: true, criadas }
}

// ------------------------------------------------------------------------------------------------------- títulos
export type TituloInput = {
  id?: number | null; fornecedorId: number; documento?: string; valor: number | string; dataEmissao?: string; dataVencimento: string
  competencia?: string; categoriaId?: number | null; observacao?: string; chave: string
}

export async function salvarTituloPagar(input: TituloInput): Promise<{ ok: true; id: number; numero: number } | Erro> {
  const __d = viaDesktop('financeiro#salvarTituloPagar', salvarTituloPagar, [input]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasPagar)
  if ('error' in ctx) return ctx
  const valor = num(input.valor)
  if (!(valor > 0)) return { error: 'Informe um valor maior que zero.' }
  if (!dataISO(input.dataVencimento)) return { error: 'Informe o vencimento.' }
  if (!Number(input.fornecedorId)) return { error: 'Escolha o fornecedor.' }
  const { data, error } = await createServiceClient().rpc('fin_titulo_pagar_salvar', {
    p_loja: ctx.lojaId, p_id: input.id ?? null, p_user: ctx.userId, p_user_nome: ctx.nome, p_chave: input.id ? null : input.chave || null,
    p_dados: {
      fornecedor_id: Number(input.fornecedorId), documento: texto(input.documento, 60), valor, data_emissao: dataISO(input.dataEmissao) || null,
      data_vencimento: input.dataVencimento, data_competencia: texto(input.competencia, 10) || null, categoria_id: input.categoriaId ?? null,
      observacao: texto(input.observacao, 500), origem_tipo: 'manual',
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; numero: number; duplicado: boolean }
  if (!r.duplicado) await registrarAuditoria(input.id ? 'editar' : 'criar', 'conta a pagar', r.id, `Título nº ${r.numero}`)
  atualizar()
  return { ok: true, id: r.id, numero: r.numero }
}

export async function cancelarTituloPagar(id: number, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('financeiro#cancelarTituloPagar', cancelarTituloPagar, [id, motivo]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.contasPagar)
  if ('error' in ctx) return ctx
  if (texto(motivo).length < 3) return { error: 'Informe o motivo do cancelamento.' }
  const { data, error } = await createServiceClient().rpc('fin_titulo_pagar_cancelar', {
    p_loja: ctx.lojaId, p_id: Number(id), p_motivo: texto(motivo), p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: msgErro(error) }
  if (!(data as { duplicado?: boolean })?.duplicado) await registrarAuditoria('cancelar', 'conta a pagar', id, texto(motivo))
  atualizar()
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------- pagamentos
export type PagamentoInput = {
  tituloId: number; contaId: number; dataPagamento: string; valorPrincipal?: number | string | null
  juros?: number | string; desconto?: number | string; forma?: string; observacao?: string; chave: string
}

export async function registrarPagamentoTitulo(input: PagamentoInput): Promise<{ ok: true; status: string; restante: number } | Erro> {
  const __d = viaDesktop('financeiro#registrarPagamentoTitulo', registrarPagamentoTitulo, [input]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.pagar)
  if ('error' in ctx) return ctx
  if (!input.chave) return { error: 'Recarregue a tela e tente de novo.' }
  if (!Number(input.contaId)) return { error: 'Escolha a conta corrente do pagamento.' }
  const vazio = input.valorPrincipal === null || input.valorPrincipal === undefined || input.valorPrincipal === ''
  const principal = vazio ? null : num(input.valorPrincipal)
  const juros = num(input.juros === undefined || input.juros === '' ? 0 : input.juros)
  const desconto = num(input.desconto === undefined || input.desconto === '' ? 0 : input.desconto)
  // Confere as contas antes de ir ao banco (o banco confere de novo, com a trava): mensagem rápida e igual.
  const pre = calcularPagamento({ restanteCent: Number.MAX_SAFE_INTEGER, principalCent: principal === null ? 1 : Math.round(principal * 100), jurosCent: Math.round(juros * 100), descontoCent: Math.round(desconto * 100) })
  if (!pre.ok && !/passa do que falta/.test(pre.erro)) return { error: pre.erro }
  const { data, error } = await createServiceClient().rpc('fin_pagamento_registrar', {
    p_loja: ctx.lojaId, p_titulo: Number(input.tituloId), p_user: ctx.userId, p_user_nome: ctx.nome, p_chave: input.chave,
    p_dados: {
      conta_id: Number(input.contaId), data_pagamento: dataISO(input.dataPagamento) || null, valor_principal: principal,
      juros, desconto, forma: texto(input.forma, 40), observacao: texto(input.observacao, 300),
    },
  })
  if (error) return { error: msgErro(error) }
  const r = data as { id: number; duplicado: boolean; status: string; restante: number }
  if (!r.duplicado) await registrarAuditoria('concluir', 'pagamento de conta a pagar', r.id, `Título ${input.tituloId}`)
  atualizar()
  return { ok: true, status: r.status, restante: Number(r.restante) }
}

export async function estornarPagamentoTitulo(pagamentoId: number, motivo: string): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('financeiro#estornarPagamentoTitulo', estornarPagamentoTitulo, [pagamentoId, motivo]); if (__d) return __d as never
  await exigirDevAcao()
  const ctx = await contexto(PERM.pagar)
  if ('error' in ctx) return ctx
  if (texto(motivo).length < 3) return { error: 'Informe o motivo do estorno.' }
  const { data, error } = await createServiceClient().rpc('fin_pagamento_estornar', {
    p_loja: ctx.lojaId, p_pagamento: Number(pagamentoId), p_motivo: texto(motivo), p_user: ctx.userId, p_user_nome: ctx.nome,
  })
  if (error) return { error: msgErro(error) }
  if (!(data as { duplicado?: boolean })?.duplicado) await registrarAuditoria('reverter', 'pagamento de conta a pagar', pagamentoId, texto(motivo))
  atualizar()
  return { ok: true }
}
