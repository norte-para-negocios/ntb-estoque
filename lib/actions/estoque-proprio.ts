'use server'

import { ehDesenvolvedor } from '@/lib/recursos-dev'
import { viaDesktop } from '@/lib/offline/via-desktop'
import { guardaModulo } from '@/lib/plataforma/guarda'

import { revalidatePath } from 'next/cache'
import { carimboUsuario, getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { ajuste, entrada, estornar, modoDaLoja } from '@/lib/estoque/ledger'
import { transferenciaRapida } from '@/lib/estoque/transferencia-proprio'
import { entradaComLote } from '@/lib/estoque/lotes'
import { avisosLotesDosMovimentos } from '@/lib/estoque/avisos-baixa'
import { dataCriacaoBahia, hojeBahiaISO } from '@/lib/data-bahia'
import { lerNumeroBR, MSG_NUMERO_BR } from '@/lib/num-br'

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

/** Texto digitado → número pela regra única (ponto = milhar, vírgula = decimal). Vazio = null; formato quebrado = NaN. */
function numero(v: unknown): number | null {
  const n = lerNumeroBR(v, { milhar: true })
  return n == null || Number.isNaN(n) || Number.isFinite(n) ? n : NaN
}
const invalido = (n: number | null) => n != null && Number.isNaN(n)

async function descreverProduto(lojaId: number, codigoProduto: number): Promise<string> {
  const { data, error } = await createServiceClient()
    .from('produtos')
    .select('codigo, descricao')
    .eq('loja_id', lojaId)
    .eq('codigo_produto', codigoProduto)
    .maybeSingle()
  // Só o texto da auditoria: sem a leitura, fica o código.
  if (error) return String(codigoProduto)
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
  /** Dia em que a mercadoria chegou (YYYY-MM-DD). Vazio = hoje. Data passada refaz o custo desde esse dia. */
  data?: string | null
}): Promise<Resposta> {
  const __d = viaDesktop('estoque-proprio#entradaManual', entradaManual, [dados]); if (__d) return __d as never
  const __g = await guardaModulo('estoque-proprio#entradaManual'); if (__g) return __g as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  const lote = dados.lote?.trim() || null
  const validade = dados.validade && /^\d{4}-\d{2}-\d{2}$/.test(dados.validade) ? dados.validade : null
  if (dados.validade && !validade) return { error: 'Validade inválida.' }
  const quantidade = numero(dados.quantidade)
  if (invalido(quantidade)) return { error: `Quantidade: ${MSG_NUMERO_BR}` }
  if (quantidade == null || quantidade <= 0) return { error: 'Informe uma quantidade maior que zero.' }
  const custo = dados.custo === '' || dados.custo == null ? null : numero(dados.custo)
  if (invalido(custo)) return { error: `Custo: ${MSG_NUMERO_BR}` }
  if (custo != null && custo < 0) return { error: 'O custo não pode ser negativo.' }
  const dia = dados.data?.trim() || null
  if (dia && !(await ehDesenvolvedor())) return { error: 'Lançar com outra data ainda está em teste.' }
  if (dia && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { error: 'Data inválida.' }
  if (dia && (lote || validade)) return { error: 'Entrada com lote ou validade só pode ser lançada na data de hoje.' }
  try {
    if (dia) {
      // 319: grava no dia em que chegou e, se for data passada, refaz o custo do produto desde então
      const { data: rd, error } = await createServiceClient().rpc('entrada_manual_com_data', {
        p_loja: ctx.lojaId, p_local: dados.codigoLocal, p_produto: dados.codigoProduto, p_quantidade: quantidade,
        p_custo: custo, p_ref: ref('em'), p_user: ctx.userId, p_obs: dados.obs?.trim() || null, p_data: dia,
      })
      if (error) throw new Error(error.message)
      const r = rd as { id: number; saldo: number; avisos?: string[] }
      await registrarAuditoria('criar', 'entrada de estoque', r.id, await descreverProduto(ctx.lojaId, dados.codigoProduto))
      atualizarTelas()
      const avisos = [
        custo == null || custo <= 0 ? 'Entrada sem custo: o custo médio não foi alterado.' : null,
        ...(Array.isArray(r.avisos) ? r.avisos.map(String) : []),
      ].filter(Boolean)
      return { ok: true, saldo: r.saldo, aviso: avisos.length ? avisos.join(' ') : undefined }
    }
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
  const __d = viaDesktop('estoque-proprio#ajusteManual', ajusteManual, [dados]); if (__d) return __d as never
  const __g = await guardaModulo('estoque-proprio#ajusteManual'); if (__g) return __g as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  if (!dados.motivo?.trim()) return { error: 'Informe o motivo do ajuste.' }
  let delta = numero(dados.diferenca)
  if (invalido(delta)) return { error: `Diferença: ${MSG_NUMERO_BR}` }
  if (delta == null && dados.novoSaldo != null && dados.novoSaldo !== '') {
    const novo = numero(dados.novoSaldo)
    if (novo == null || invalido(novo)) return { error: `Saldo contado inválido. ${MSG_NUMERO_BR}` }
    // Recalcula contra o saldo real do banco, não contra o que a tela mostrava.
    const { data, error } = await createServiceClient()
      .from('estoque_saldos').select('saldo')
      .eq('loja_id', ctx.lojaId).eq('codigo_local_estoque', dados.codigoLocal).eq('codigo_produto', dados.codigoProduto)
      .maybeSingle()
    // Sem o saldo real, a diferença sairia contra zero (ajuste errado no ledger).
    if (error) return { error: `Não foi possível ler o saldo atual: ${error.message}` }
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
    // 05/11/2026: saída que consumiu lote vencido (FEFO) não bloqueia; avisa
    const vencidos = delta < 0 ? await avisosLotesDosMovimentos(ctx.lojaId, [r.id]) : []
    return { ok: true, saldo: r.saldo, negativo: r.negativo, ...(vencidos.length ? { aviso: [...vencidos, ...(r.negativo ? ['Atenção: o saldo ficou negativo.'] : [])].join(' ') } : {}) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao registrar o ajuste' }
  }
}

export async function definirMinimo(dados: {
  codigoProduto: number
  codigoLocal: number
  minimo: number | string | null
}): Promise<Resposta> {
  const __d = viaDesktop('estoque-proprio#definirMinimo', definirMinimo, [dados]); if (__d) return __d as never
  const __g = await guardaModulo('estoque-proprio#definirMinimo'); if (__g) return __g as never
  const ctx = await contexto('Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  const minimo = dados.minimo === '' || dados.minimo == null ? null : numero(dados.minimo)
  if (invalido(minimo)) return { error: `Mínimo: ${MSG_NUMERO_BR}` }
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
  const __d = viaDesktop('estoque-proprio#transferirEntreLocais', transferirEntreLocais, [dados]); if (__d) return __d as never
  const __g = await guardaModulo('estoque-proprio#transferirEntreLocais'); if (__g) return __g as never
  const ctx = await contexto('Transferencias - Criar')
  if ('error' in ctx) return ctx
  const quantidade = numero(dados.quantidade)
  if (invalido(quantidade)) return { error: `Quantidade: ${MSG_NUMERO_BR}` }
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
  const __d = viaDesktop('estoque-proprio#estornarMovimento', estornarMovimento, [idMovimento]); if (__d) return __d as never
  const __g = await guardaModulo('estoque-proprio#estornarMovimento'); if (__g) return __g as never
  const ctx = await contexto('Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  // Só estorna movimento desta loja.
  const { data: mov, error: erroMov } = await createServiceClient()
    .from('estoque_movimentos').select('id, loja_id, codigo_produto').eq('id', idMovimento).maybeSingle()
  if (erroMov) return { error: erroMov.message }
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
