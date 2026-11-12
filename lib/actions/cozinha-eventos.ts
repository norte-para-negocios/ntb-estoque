'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { STATUS_EVENTO } from '@/lib/custo-cardapio/eventos-puro'

// Norte Cozinha (só dev): eventos (orçamento por convidado, produção e compras). Grava só em custo_evento*,
// nunca no Omie nem no estoque. Toda escrita é filtrada pela loja atual.

type Resultado = { ok: true } | { error: string }
type ResultadoId = { ok: true; id: number } | { error: string }

export type DadosEvento = {
  nome: string
  dataEvento: string | null
  convidados: number
  status: string
  precoPorPessoa: number | null
  obs: string | null
}

async function contexto(): Promise<{ lojaId: number; ator: string } | { error: string }> {
  await exigirDevAcao()
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
  return { row: { nome, data_evento: data, convidados, status: d.status, preco_por_pessoa: preco, obs } }
}

async function eventoDaLoja(lojaId: number, eventoId: number): Promise<boolean> {
  const { data } = await createServiceClient().from('custo_eventos').select('id').eq('id', eventoId).eq('loja_id', lojaId).maybeSingle()
  return !!data
}

function revalidar(id?: number) {
  revalidatePath('/cozinha/eventos')
  if (id) revalidatePath(`/cozinha/eventos/${id}`)
}

async function tocar(lojaId: number, eventoId: number) {
  await createServiceClient().from('custo_eventos').update({ updated_at: new Date().toISOString() }).eq('id', eventoId).eq('loja_id', lojaId)
}

export async function criarEvento(nome: string, dataEvento: string | null, convidados: number): Promise<ResultadoId> {
  const __d = viaDesktop('cozinha-eventos#criarEvento', criarEvento, [nome, dataEvento, convidados]); if (__d) return __d as never
  const c = await contexto()
  if ('error' in c) return c
  const v = validarDados({ nome, dataEvento, convidados, status: 'orcamento', precoPorPessoa: null, obs: null })
  if ('error' in v) return v
  const { data, error } = await createServiceClient().from('custo_eventos').insert({ ...v.row, loja_id: c.lojaId, criado_por: c.ator }).select('id').single()
  if (error || !data) return { error: error?.message ?? 'Não foi possível criar o evento.' }
  revalidar()
  return { ok: true, id: Number(data.id) }
}

export async function salvarEvento(id: number, dados: DadosEvento): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#salvarEvento', salvarEvento, [id, dados]); if (__d) return __d as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Evento inválido.' }
  const v = validarDados(dados)
  if ('error' in v) return v
  const { data, error } = await createServiceClient().from('custo_eventos').update({ ...v.row, updated_at: new Date().toISOString() })
    .eq('id', id).eq('loja_id', c.lojaId).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Evento não encontrado nesta loja.' }
  revalidar(id)
  return { ok: true }
}

export async function excluirEvento(id: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#excluirEvento', excluirEvento, [id]); if (__d) return __d as never
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(id)) return { error: 'Evento inválido.' }
  const { data, error } = await createServiceClient().from('custo_eventos').delete().eq('id', id).eq('loja_id', c.lojaId).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Evento não encontrado nesta loja.' }
  revalidar()
  return { ok: true }
}

export async function adicionarItemEvento(eventoId: number, codigo: number, porcoesPorConvidado: number): Promise<Resultado> {
  const __d = viaDesktop('cozinha-eventos#adicionarItemEvento', adicionarItemEvento, [eventoId, codigo, porcoesPorConvidado]); if (__d) return __d as never
  const c = await contexto()
  if ('error' in c) return c
  const porcoes = validarPorcoes(porcoesPorConvidado)
  if (!idValido(eventoId) || !idValido(codigo) || porcoes == null) return { error: 'Pedido inválido.' }
  if (!(await eventoDaLoja(c.lojaId, eventoId))) return { error: 'Evento não encontrado nesta loja.' }
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
  const c = await contexto()
  if ('error' in c) return c
  const porcoes = validarPorcoes(porcoesPorConvidado)
  if (!idValido(itemId)) return { error: 'Item inválido.' }
  if (porcoes == null) return { error: 'Porções por convidado deve ficar entre 0,001 e 100.' }
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
  const c = await contexto()
  if ('error' in c) return c
  if (!idValido(itemId)) return { error: 'Item inválido.' }
  const { data, error } = await createServiceClient().from('custo_evento_itens').delete().eq('id', itemId).eq('loja_id', c.lojaId).select('evento_id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Item não encontrado nesta loja.' }
  await tocar(c.lojaId, Number(data[0].evento_id))
  revalidar(Number(data[0].evento_id))
  return { ok: true }
}
