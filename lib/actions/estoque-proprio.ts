'use server'

import { revalidatePath } from 'next/cache'
import { carimboUsuario, getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { ajuste, entrada, estornar, modoDaLoja } from '@/lib/estoque/ledger'
import { transferenciaRapida } from '@/lib/estoque/transferencia-proprio'
import { entradaComLote } from '@/lib/estoque/lotes'
import { dataCriacaoBahia, hojeBahiaISO } from '@/lib/data-bahia'

type Resposta = { ok: true; saldo?: number; negativo?: boolean; aviso?: string } | { error: string }

/** Toda ação aqui só vale para loja em modo "proprio" e com permissão de movimentação. */
async function contexto(permissao = 'Movimentacoes - Criar'): Promise<{ lojaId: number; userId: string | null } | { error: string }> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa o estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const user = await getUser()
  return { lojaId, userId: user?.id ?? null }
}

function ref(prefixo: string): string {
  return `${prefixo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

async function descreverProduto(lojaId: number, codigoProduto: number): Promise<string> {
  const { data } = await createServiceClient()
    .from('produtos')
    .select('codigo, descricao')
    .eq('loja_id', lojaId)
    .eq('codigo_produto', codigoProduto)
    .maybeSingle()
  return data ? `${data.descricao} (${data.codigo})` : String(codigoProduto)
}

function atualizarTelas() {
  revalidatePath('/estoque')
  revalidatePath('/home')
}

export async function entradaManual(dados: {
  codigoProduto: number
  codigoLocal: number
  quantidade: number | string
  custo?: number | string | null
  obs?: string
  /** Lote e validade (opcionais): a entrada vira um lote com vencimento (tela Validade). */
  lote?: string | null
  validade?: string | null
}): Promise<Resposta> {
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  const lote = dados.lote?.trim() || null
  const validade = dados.validade && /^\d{4}-\d{2}-\d{2}$/.test(dados.validade) ? dados.validade : null
  if (dados.validade && !validade) return { error: 'Validade inválida.' }
  const quantidade = numero(dados.quantidade)
  if (quantidade == null || quantidade <= 0) return { error: 'Informe uma quantidade maior que zero.' }
  const custo = dados.custo === '' || dados.custo == null ? null : numero(dados.custo)
  if (custo != null && custo < 0) return { error: 'O custo não pode ser negativo.' }
  try {
    const r = lote || validade
      ? await entradaComLote({
          lojaId: ctx.lojaId, local: dados.codigoLocal, produto: dados.codigoProduto, origem: 'ENTRADA_MANUAL', ref: ref('em'),
          quantidade, custo, user: ctx.userId, obs: dados.obs?.trim() || null, lote, validade,
        })
      : await entrada({
          lojaId: ctx.lojaId, local: dados.codigoLocal, produto: dados.codigoProduto, origem: 'ENTRADA_MANUAL', ref: ref('em'),
          quantidade, custo, user: ctx.userId, obs: dados.obs?.trim() || null,
        })
    await registrarAuditoria('criar', 'entrada de estoque', r.id, await descreverProduto(ctx.lojaId, dados.codigoProduto))
    atualizarTelas()
    return {
      ok: true, saldo: r.saldo,
      aviso: custo == null || custo <= 0 ? 'Entrada sem custo: o custo médio não foi alterado.' : undefined,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao registrar a entrada' }
  }
}

/** Ajuste com sinal. `novoSaldo` (contagem) ou `diferenca` (quanto sobra/falta), um dos dois. */
export async function ajusteManual(dados: {
  codigoProduto: number
  codigoLocal: number
  diferenca?: number | string | null
  novoSaldo?: number | string | null
  saldoAtual?: number
  motivo: string
}): Promise<Resposta> {
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  if (!dados.motivo?.trim()) return { error: 'Informe o motivo do ajuste.' }
  let delta = numero(dados.diferenca)
  if (delta == null && dados.novoSaldo != null && dados.novoSaldo !== '') {
    const novo = numero(dados.novoSaldo)
    if (novo == null) return { error: 'Saldo contado inválido.' }
    // Recalcula contra o saldo real do banco, não contra o que a tela mostrava.
    const { data } = await createServiceClient()
      .from('estoque_saldos').select('saldo')
      .eq('loja_id', ctx.lojaId).eq('codigo_local_estoque', dados.codigoLocal).eq('codigo_produto', dados.codigoProduto)
      .maybeSingle()
    delta = novo - Number(data?.saldo ?? 0)
  }
  if (delta == null || delta === 0) return { error: 'Nada a ajustar: a diferença é zero.' }
  try {
    const r = await ajuste({
      lojaId: ctx.lojaId, local: dados.codigoLocal, produto: dados.codigoProduto, origem: 'AJUSTE_MANUAL', ref: ref('aj'),
      quantidade: delta, user: ctx.userId, obs: dados.motivo.trim(),
    })
    await registrarAuditoria('editar', 'ajuste de estoque', r.id, await descreverProduto(ctx.lojaId, dados.codigoProduto))
    atualizarTelas()
    return { ok: true, saldo: r.saldo, negativo: r.negativo }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao registrar o ajuste' }
  }
}

export async function definirMinimo(dados: {
  codigoProduto: number
  codigoLocal: number
  minimo: number | string | null
}): Promise<Resposta> {
  const ctx = await contexto('Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  const minimo = dados.minimo === '' || dados.minimo == null ? null : numero(dados.minimo)
  if (minimo != null && minimo < 0) return { error: 'O mínimo não pode ser negativo.' }
  const supabase = createServiceClient()
  const { error } = await supabase.from('estoque_saldos').upsert(
    { loja_id: ctx.lojaId, codigo_local_estoque: dados.codigoLocal, codigo_produto: dados.codigoProduto, minimo, updated_at: new Date().toISOString() },
    { onConflict: 'loja_id,codigo_local_estoque,codigo_produto', ignoreDuplicates: false },
  )
  if (error) return { error: error.message }
  await registrarAuditoria('editar', 'estoque mínimo', dados.codigoProduto, await descreverProduto(ctx.lojaId, dados.codigoProduto))
  atualizarTelas()
  return { ok: true }
}

export async function transferirEntreLocais(dados: {
  codigoProduto: number
  de: number
  para: number
  quantidade: number | string
  obs?: string
}): Promise<Resposta> {
  const ctx = await contexto('Transferencias - Criar')
  if ('error' in ctx) return ctx
  const quantidade = numero(dados.quantidade)
  if (quantidade == null || quantidade <= 0) return { error: 'Informe uma quantidade maior que zero.' }
  if (dados.de === dados.para) return { error: 'Escolha locais diferentes.' }
  try {
    // Mesmo fluxo da tela de Transferências: cria o documento (aparece lá com o histórico de sempre) e lança o par no ledger.
    const r = await transferenciaRapida({
      lojaId: ctx.lojaId, userId: ctx.userId, carimbo: await carimboUsuario(), de: dados.de, para: dados.para,
      produto: dados.codigoProduto, quantidade, observacao: dados.obs ?? null,
      dataIso: dataCriacaoBahia(hojeBahiaISO())!,
    })
    if ('error' in r) return { error: r.error }
    await registrarAuditoria('criar', 'transferência de estoque', r.transferenciaId, await descreverProduto(ctx.lojaId, dados.codigoProduto))
    atualizarTelas()
    revalidatePath('/transferencia')
    return { ok: true, saldo: r.saldoDestino ?? undefined, negativo: r.negativo }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao transferir' }
  }
}

export async function estornarMovimento(idMovimento: number): Promise<Resposta> {
  const ctx = await contexto('Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  // Só estorna movimento desta loja.
  const { data: mov } = await createServiceClient()
    .from('estoque_movimentos').select('id, loja_id, codigo_produto').eq('id', idMovimento).maybeSingle()
  if (!mov || mov.loja_id !== ctx.lojaId) return { error: 'Movimento não encontrado.' }
  try {
    const r = await estornar(idMovimento, ctx.userId)
    await registrarAuditoria('reverter', 'movimento de estoque', idMovimento, await descreverProduto(ctx.lojaId, Number(mov.codigo_produto)))
    atualizarTelas()
    return { ok: true, saldo: r.saldo }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao estornar' }
  }
}
