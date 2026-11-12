'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'
import { guardaModulo } from '@/lib/plataforma/guarda'

import { revalidatePath } from 'next/cache'
import { carimboUsuario, getAtorGestao, getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { carregarEvento, insumosDoEvento } from '@/lib/custo-cardapio/eventos'
import { FOLGA_MAX, lerConsumoReal, STATUS_EVENTO, validarConsumo } from '@/lib/custo-cardapio/eventos-puro'
import { modoDaLoja, saida } from '@/lib/estoque/ledger'
import { exigirPeriodoAberto } from '@/lib/estoque/periodo-fechado'
import { hojeBahiaISO } from '@/lib/data-bahia'

// Norte Cozinha (só dev): eventos (orçamento por convidado, produção e compras). Grava em custo_evento*; a única escrita
// fora disso é a baixa do consumo real no ledger do estoque PRÓPRIO (darBaixaEvento). Nunca escreve no Omie.
// Toda escrita é filtrada pela loja atual.

type Resultado = { ok: true } | { error: string }
type ResultadoId = { ok: true; id: number } | { error: string }

export type DadosEvento = {
  nome: string
  dataEvento: string | null
  convidados: number
  status: string
  precoPorPessoa: number | null
  obs: string | null
  /** Folga de produção em % (0 a 200). */
  folgaPct: number
}

async function contexto(): Promise<{ lojaId: number; ator: string } | { error: string }> {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão' }
  const lojaId = await getCurrentLojaId()
  if (!ator.lojaIds.includes(lojaId)) return { error: 'Sem permissão nesta loja' }
  return { lojaId, ator: ator.id }
}

const idValido = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0

function dataValida(d: unknown): string | null | false {
  if (d == null || d === '') return null
  const s = String(d).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [a, m, dia] = s.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, dia))
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === dia && a >= 2000 && a <= 2100 ? s : false
}

function validarConvidados(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 100000 ? n : null
}

function validarPorcoes(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 1000) / 1000 : null
}

function validarDados(d: DadosEvento): { row: Record<string, unknown> } | { error: string } {
  const nome = String(d?.nome ?? '').replace(/\s+/g, ' ').trim()
  if (nome.length < 1 || nome.length > 120) return { error: 'O nome deve ter entre 1 e 120 caracteres.' }
  const data = dataValida(d.dataEvento)
  if (data === false) return { error: 'Data inválida.' }
  const convidados = validarConvidados(d.convidados)
  if (convidados == null) return { error: 'Convidados deve ser um número inteiro entre 1 e 100.000.' }
  if (!(STATUS_EVENTO as readonly string[]).includes(String(d.status))) return { error: 'Status inválido.' }
  let preco: number | null = null
  if (d.precoPorPessoa != null) {
    const n = Number(d.precoPorPessoa)
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { error: 'Preço por pessoa inválido.' }
    preco = Math.round(n * 100) / 100
  }
  const obs = d.obs == null ? null : String(d.obs).trim().slice(0, 2000) || null
  const folga = Number(d.folgaPct ?? 0)
  if (!Number.isFinite(folga) || folga < 0 || folga > FOLGA_MAX) return { error: `A folga deve ficar entre 0% e ${FOLGA_MAX}%.` }
  return { row: { nome, data_evento: data, convidados, status: d.status, preco_por_pessoa: preco, obs, folga_pct: Math.round(folga * 100) / 100 } }
}

type EstadoDb = { id: number; nome: string; data_evento: string | null; status: string; finalizado_em: string | null; baixa_ref: string | null; consumo_real: unknown }

async function estadoDoEvento(lojaId: number, eventoId: number): Promise<EstadoDb | null> {
  const { data } = await createServiceClient().from('custo_eventos').select('id, nome, data_evento, status, finalizado_em, baixa_ref, consumo_real')
    .eq('id', eventoId).eq('loja_id', lojaId).maybeSingle()
  return (data as EstadoDb | null) ?? null
}

const FINALIZADO = 'Evento finalizado: reabra para mudar.'

/** Evento da loja e ainda editável (não finalizado). */
async function eventoEditavel(lojaId: number, eventoId: number): Promise<{ ok: true } | { error: string }> {
  const e = await estadoDoEvento(lojaId, eventoId)
  if (!e) return { error: 'Evento não encontrado nesta loja.' }
  if (e.finalizado_em) return { error: FINALIZADO }
  return { ok: true }
}

async function eventoDoItem(lojaId: number, itemId: number): Promise<number | null> {
  const { data } = await createServiceClient().from('custo_evento_itens').select('evento_id').eq('id', itemId).eq('loja_id', lojaId).maybeSingle()
  return data ? Number(data.evento_id) : null
}

const refBaixa = (eventoId: number) => `EV-${eventoId}`

function revalidar(id?: number) {
  revalidatePath('/cozinha/eventos')
  if (id) revalidatePath(`/cozinha/eventos/${id}`)
}

async function tocar(lojaId: number, eventoId: number) {
  await createServiceClient().from('custo_eventos').update({ updated_at: new Date().toISOString() }).eq('id', eventoId).eq('loja_id', lojaId)
}

export async function criarEvento(nome: string, dataEvento: string | null, convidados: number): Promise<ResultadoId> {
  const __d = viaDesktop('cozinha-eventos#criarEvento', criarEvento, [nome, dataEvento, convidados]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#criarEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  const v = validarDados({ nome, dataEvento, convidados, status: 'orcamento', precoPorPessoa: null, obs: null, folgaPct: 0 })
  if ('error' in v) return v
  const { data, error } = await createServiceClient().from('custo_eventos').insert({ ...v.row, loja_id: c.lojaId, criado_por: c.ator }).select('id').single()
  if (error || !data) return { error: error?.message ?? 'Não foi possível criar o evento.' }
  revalidar()
  return { ok: true, id: Number(data.id) }
}

export async function salvarEvento(id: number, dados: DadosEvento): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#salvarEvento', salvarEvento, [id, dados]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#salvarEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Evento inválido.' }
  const v = validarDados(dados)
  if ('error' in v) return v
  const ed = await eventoEditavel(c.lojaId, id)
  if ('error' in ed) return ed
  const { data, error } = await createServiceClient().from('custo_eventos').update({ ...v.row, updated_at: new Date().toISOString() })
    .eq('id', id).eq('loja_id', c.lojaId).is('finalizado_em', null).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Evento não encontrado nesta loja.' }
  revalidar(id)
  return { ok: true }
}

export async function excluirEvento(id: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#excluirEvento', excluirEvento, [id]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#excluirEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Evento inválido.' }
  const e = await estadoDoEvento(c.lojaId, id)
  if (!e) return { error: 'Evento não encontrado nesta loja.' }
  if (e.baixa_ref || (await temMovimentoDeBaixa(c.lojaId, id).catch(() => true))) return { error: 'O consumo deste evento já foi lançado no estoque: ele não pode ser excluído.' }
  const { data, error } = await createServiceClient().from('custo_eventos').delete().eq('id', id).eq('loja_id', c.lojaId).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Evento não encontrado nesta loja.' }
  revalidar()
  return { ok: true }
}

export async function adicionarItemEvento(eventoId: number, codigo: number, porcoesPorConvidado: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#adicionarItemEvento', adicionarItemEvento, [eventoId, codigo, porcoesPorConvidado]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#adicionarItemEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  const porcoes = validarPorcoes(porcoesPorConvidado)
  if (!idValido(eventoId) || !idValido(codigo) || porcoes == null) return { error: 'Pedido inválido.' }
  const ed = await eventoEditavel(c.lojaId, eventoId)
  if ('error' in ed) return ed
  const base = await carregarBase(c.lojaId)
  if (!base) return { error: 'Esta loja não controla estoque.' }
  const p = base.produtos.get(Number(codigo))
  if (!p || p.inativo || !base.fichas.has(Number(codigo))) return { error: 'Este produto não tem ficha técnica nesta loja.' }
  const sb = createServiceClient()
  const { data: ultimo } = await sb.from('custo_evento_itens').select('ordem').eq('evento_id', eventoId).eq('loja_id', c.lojaId)
    .order('ordem', { ascending: false }).limit(1).maybeSingle()
  const { error } = await sb.from('custo_evento_itens').insert({
    evento_id: eventoId, loja_id: c.lojaId, codigo_produto: Number(codigo), porcoes_por_convidado: porcoes, ordem: Number(ultimo?.ordem ?? -1) + 1,
  })
  if (error) return { error: /duplicate|unique/i.test(error.message) ? 'Este prato já está no evento.' : error.message }
  await tocar(c.lojaId, eventoId)
  revalidar(eventoId)
  return { ok: true }
}

export async function definirPorcoesItemEvento(itemId: number, porcoesPorConvidado: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#definirPorcoesItemEvento', definirPorcoesItemEvento, [itemId, porcoesPorConvidado]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#definirPorcoesItemEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  const porcoes = validarPorcoes(porcoesPorConvidado)
  if (!idValido(itemId)) return { error: 'Item inválido.' }
  if (porcoes == null) return { error: 'Porções por convidado deve ficar entre 0,001 e 100.' }
  const ev = await eventoDoItem(c.lojaId, itemId)
  if (ev == null) return { error: 'Item não encontrado nesta loja.' }
  const ed = await eventoEditavel(c.lojaId, ev)
  if ('error' in ed) return ed
  const { data, error } = await createServiceClient().from('custo_evento_itens').update({ porcoes_por_convidado: porcoes })
    .eq('id', itemId).eq('loja_id', c.lojaId).select('evento_id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Item não encontrado nesta loja.' }
  await tocar(c.lojaId, Number(data[0].evento_id))
  revalidar(Number(data[0].evento_id))
  return { ok: true }
}

export async function removerItemEvento(itemId: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#removerItemEvento', removerItemEvento, [itemId]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#removerItemEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(itemId)) return { error: 'Item inválido.' }
  const ev = await eventoDoItem(c.lojaId, itemId)
  if (ev == null) return { error: 'Item não encontrado nesta loja.' }
  const ed = await eventoEditavel(c.lojaId, ev)
  if ('error' in ed) return ed
  const { data, error } = await createServiceClient().from('custo_evento_itens').delete().eq('id', itemId).eq('loja_id', c.lojaId).select('evento_id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Item não encontrado nesta loja.' }
  await tocar(c.lojaId, Number(data[0].evento_id))
  revalidar(Number(data[0].evento_id))
  return { ok: true }
}

/** Muda só a situação (botão do "Próximo passo"). Evento finalizado não muda por aqui. */
export async function definirStatusEvento(id: number, status: string): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#definirStatusEvento', definirStatusEvento, [id, status]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#definirStatusEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Evento inválido.' }
  if (!(STATUS_EVENTO as readonly string[]).includes(String(status))) return { error: 'Status inválido.' }
  const ed = await eventoEditavel(c.lojaId, id)
  if ('error' in ed) return ed
  const { data, error } = await createServiceClient().from('custo_eventos').update({ status, updated_at: new Date().toISOString() })
    .eq('id', id).eq('loja_id', c.lojaId).is('finalizado_em', null).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: FINALIZADO }
  revalidar(id)
  return { ok: true }
}

/**
 * Fecha o evento com o consumo real (insumo → quantidade usada, na unidade da ficha, já com a folga se foi usada).
 * Confere que a lista tem todos os insumos do evento salvo e só eles. Status vira "realizado". Não mexe no estoque.
 */
export async function finalizarEvento(id: number, consumo: { codigo: number; quantidade: number }[]): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#finalizarEvento', finalizarEvento, [id, consumo]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#finalizarEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Evento inválido.' }
  const base = await carregarBase(c.lojaId)
  if (!base) return { error: 'Esta loja não controla estoque.' }
  const e = await carregarEvento(base, id)
  if (!e) return { error: 'Evento não encontrado nesta loja.' }
  if (e.finalizado_em) return { error: 'Este evento já foi finalizado.' }
  if (e.status === 'cancelado') return { error: 'Evento cancelado não é finalizado.' }
  const esperados = insumosDoEvento(base, e)
  if (!esperados.size) return { error: 'O evento não tem insumos pela ficha técnica.' }
  const v = validarConsumo(consumo, esperados)
  if ('error' in v) return v
  const quem = (await carimboUsuario()).replace(/^NTB Estoque · /, '')
  const { data, error } = await createServiceClient().from('custo_eventos').update({
    consumo_real: v.consumo, finalizado_em: new Date().toISOString(), finalizado_por: quem.slice(0, 120), status: 'realizado', updated_at: new Date().toISOString(),
  }).eq('id', id).eq('loja_id', c.lojaId).is('finalizado_em', null).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Este evento já foi finalizado.' }
  revalidar(id)
  return { ok: true }
}

async function temMovimentoDeBaixa(lojaId: number, eventoId: number): Promise<boolean> {
  const { data, error } = await createServiceClient().from('estoque_movimentos').select('id')
    .eq('loja_id', lojaId).eq('origem', 'EVENTO').eq('ref', refBaixa(eventoId)).limit(1)
  if (error) throw new Error(`Não foi possível conferir a baixa do evento: ${error.message}`)
  return (data ?? []).length > 0
}

/** Reabre um evento finalizado. Só se nada foi lançado no estoque (nem em parte). */
export async function reabrirEvento(id: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#reabrirEvento', reabrirEvento, [id]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#reabrirEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Evento inválido.' }
  const e = await estadoDoEvento(c.lojaId, id)
  if (!e) return { error: 'Evento não encontrado nesta loja.' }
  if (!e.finalizado_em) return { ok: true }
  if (e.baixa_ref) return { error: 'O consumo já foi lançado no estoque: o evento não pode ser reaberto.' }
  try {
    if (await temMovimentoDeBaixa(c.lojaId, id)) return { error: 'Parte do consumo já saiu do estoque. Termine a baixa; o evento não pode ser reaberto.' }
  } catch (err) { return { error: (err as Error).message } }
  const { data, error } = await createServiceClient().from('custo_eventos').update({
    finalizado_em: null, finalizado_por: null, consumo_real: null, updated_at: new Date().toISOString(),
  }).eq('id', id).eq('loja_id', c.lojaId).is('baixa_ref', null).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'O consumo já foi lançado no estoque: o evento não pode ser reaberto.' }
  revalidar(id)
  return { ok: true }
}

/**
 * Estoque PRÓPRIO: tira do estoque o consumo real do evento finalizado, um movimento de saída por insumo
 * (registrar_movimento SAI, origem EVENTO, ref EV-<id>, linha 0). Idempotente: repetir depois de uma falha no meio
 * não duplica (o banco reconhece a mesma origem/ref/produto/local/linha). Se a baixa já começou, usa o mesmo local.
 */
export async function darBaixaEvento(id: number, local: number): Promise<{ ok: true; itens: number; local: number } | { error: string }> {
  const __d = viaDesktop('cozinha-eventos#darBaixaEvento', darBaixaEvento, [id, local]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#darBaixaEvento'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id) || !idValido(local)) return { error: 'Pedido inválido.' }
  if (!(await requirePermissao(c.lojaId, 'Movimentacoes - Criar'))) return { error: 'Sem permissão para lançar movimento de estoque.' }
  if ((await modoDaLoja(c.lojaId)) !== 'proprio') return { error: 'Esta loja usa o estoque do Omie: lance o consumo pela tela de ajustes.' }
  const e = await estadoDoEvento(c.lojaId, id)
  if (!e) return { error: 'Evento não encontrado nesta loja.' }
  if (!e.finalizado_em) return { error: 'Finalize o evento com o consumo real antes de dar baixa.' }
  if (e.baixa_ref) return { error: 'A baixa deste evento já foi feita.' }
  const consumo = [...(lerConsumoReal(e.consumo_real) ?? new Map<number, number>()).entries()].filter(([, q]) => q > 0).sort(([a], [b]) => a - b)
  if (!consumo.length) return { error: 'Nenhum insumo com quantidade usada maior que zero.' }

  const sb = createServiceClient()
  const ref = refBaixa(id)
  // Baixa que já começou (falha no meio): continua no mesmo local, senão a repetição duplicaria em outro local.
  const { data: ja, error: eJa } = await sb.from('estoque_movimentos').select('codigo_local_estoque').eq('loja_id', c.lojaId).eq('origem', 'EVENTO').eq('ref', ref).limit(1)
  if (eJa) return { error: eJa.message }
  const localUsado = ja?.length ? Number(ja[0].codigo_local_estoque) : Number(local)
  const { data: loc } = await sb.from('local_estoques').select('codigo_local_estoque, inativo').eq('loja_id', c.lojaId)
    .eq('codigo_local_estoque', localUsado).is('deleted_at', null).maybeSingle()
  if (!loc || (!ja?.length && loc.inativo === 'S')) return { error: 'Local de estoque inválido nesta loja.' }

  const hoje = hojeBahiaISO()
  const data = e.data_evento && String(e.data_evento).slice(0, 10) <= hoje ? String(e.data_evento).slice(0, 10) : hoje
  const travado = await exigirPeriodoAberto(c.lojaId, [data], 'baixa do evento')
  if (travado) return { error: travado }

  const user = await carimboUsuario()
  const obs = `Consumo do evento ${e.nome}`.slice(0, 200)
  let feitos = 0
  for (const [produto, quantidade] of consumo) {
    try {
      await saida({ lojaId: c.lojaId, local: localUsado, produto, origem: 'EVENTO', ref, quantidade, user, obs, linha: 0, data })
      feitos++
    } catch (err) {
      revalidar(id)
      return { error: `Baixa parcial: ${feitos} de ${consumo.length} insumos lançados. Tente de novo (o que já saiu não é repetido). Erro: ${(err as Error).message}` }
    }
  }
  const { error } = await sb.from('custo_eventos').update({ baixa_ref: ref, updated_at: new Date().toISOString() })
    .eq('id', id).eq('loja_id', c.lojaId).is('baixa_ref', null)
  if (error) return { error: `Estoque baixado, mas não deu para marcar o evento: ${error.message}. Tente de novo.` }
  revalidatePath('/estoque')
  revalidar(id)
  return { ok: true, itens: feitos, local: localUsado }
}

/** Loja Omie: o consumo é lançado à mão no ERP; aqui só registra que foi lançado (trava a reabertura). Não escreve no Omie. */
export async function marcarConsumoLancado(id: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#marcarConsumoLancado', marcarConsumoLancado, [id]); if (__d) return __d as never
  const __g = await guardaModulo('cozinha-eventos#marcarConsumoLancado'); if (__g) return __g as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Evento inválido.' }
  if ((await modoDaLoja(c.lojaId)) !== 'omie') return { error: 'Nesta loja a baixa é feita pelo botão "Dar baixa no estoque".' }
  const e = await estadoDoEvento(c.lojaId, id)
  if (!e) return { error: 'Evento não encontrado nesta loja.' }
  if (!e.finalizado_em) return { error: 'Finalize o evento com o consumo real antes.' }
  if (e.baixa_ref) return { ok: true }
  const { error } = await createServiceClient().from('custo_eventos').update({ baixa_ref: `ERP-${id}`, updated_at: new Date().toISOString() })
    .eq('id', id).eq('loja_id', c.lojaId).is('baixa_ref', null)
  if (error) return { error: error.message }
  revalidar(id)
  return { ok: true }
}
