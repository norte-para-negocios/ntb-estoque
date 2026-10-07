import type { SupabaseClient } from '@supabase/supabase-js'
import { montarFatoBulk, lotesDeCupons, type VendaDb, type ItemDb, type PagamentoDb } from './fechamento-frio'

// Lado servidor do fechamento de venda do Norte Vendas: grava a venda (fonte de verdade no Estoque), reconstrói o
// pré-agregado de faturamento (RPC) e espelha o fato no Postgres do Contabo (ntb-frio-api, POST /fat_cupons_bulk).

export type FechamentoBody = {
  pedidoRef?: string; data?: string; hora?: string; tipo?: string; mesa?: string | number | null
  cancelado?: boolean; devolvido?: boolean; valor?: number; desconto?: number; taxa?: number; operador?: string | null
  nota?: { chave?: string | null; numero?: string | number | null; serie?: string | number | null; status?: string | null } | null
  itens?: { linha?: number; codigo?: string; nome?: string; quantidade?: number; valorUnitario?: number; desconto?: number; valor?: number; ncm?: string | null; cfop?: string | null }[]
  pagamentos?: { sequencia?: number; metodo?: string; valor?: number; bandeira?: string | null }[]
}

export type ResultadoFechamento = { ok: boolean; venda_id?: number; n_id_cupom?: number; duplicado?: boolean; frio: 'enviado' | 'pendente' | 'desligado'; erro?: string }

export function validarFechamento(b: FechamentoBody | null): string | null {
  if (!b || !b.pedidoRef || !b.pedidoRef.trim()) return 'pedidoRef obrigatório'
  if (b.data && !/^\d{4}-\d{2}-\d{2}$/.test(b.data)) return 'data deve ser AAAA-MM-DD'
  if (b.itens && !Array.isArray(b.itens)) return 'itens deve ser uma lista'
  if (b.pagamentos && !Array.isArray(b.pagamentos)) return 'pagamentos deve ser uma lista'
  if ((b.itens?.length ?? 0) > 500) return 'itens demais'
  return null
}

const frioConfigurado = () => !!process.env.NTB_FRIO_API_URL

/** Envia ao Contabo as vendas indicadas (ou as pendentes da loja). Nunca lança: falha deixa `frio_enviado_em` nulo para o reenvio. */
export async function enviarFatoFrio(supabase: SupabaseClient, lojaId: number, opts: { vendaIds?: number[]; limite?: number } = {}): Promise<{ enviadas: number; pendentes: number; erro?: string }> {
  if (!frioConfigurado()) return { enviadas: 0, pendentes: 0 }
  let q = supabase.from('vendas_proprio').select('id, n_id_cupom, data, hora, valor, cancelado, devolvido, nota_chave, nota_numero, nota_serie').eq('loja_id', lojaId)
  q = opts.vendaIds?.length ? q.in('id', opts.vendaIds) : q.is('frio_enviado_em', null).order('id').limit(opts.limite ?? 200)
  const { data: vendas, error } = await q
  if (error) return { enviadas: 0, pendentes: 0, erro: error.message }
  if (!vendas?.length) return { enviadas: 0, pendentes: 0 }
  const ids = vendas.map((v) => v.id)
  const [{ data: itens }, { data: pagamentos }] = await Promise.all([
    supabase.from('vendas_proprio_itens').select('id, venda_id, codigo_produto, nome, quantidade, valor_unitario, desconto, valor, ncm, cfop').in('venda_id', ids),
    supabase.from('vendas_proprio_pagamentos').select('venda_id, sequencia, tipo_doc, valor').in('venda_id', ids),
  ])
  const fato = montarFatoBulk(vendas as VendaDb[], (itens ?? []) as ItemDb[], (pagamentos ?? []) as PagamentoDb[])
  const idPorCupom = new Map(vendas.map((v) => [Number(v.n_id_cupom), v.id]))
  let enviadas = 0
  for (const lote of lotesDeCupons(fato)) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 15000)
      const resp = await fetch(`${process.env.NTB_FRIO_API_URL}/fat_cupons_bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.NTB_FRIO_API_KEY ?? '' },
        body: JSON.stringify({ loja_id: lojaId, cupons: lote.cupons, itens: lote.itens, pagamentos: lote.pagamentos }), signal: controller.signal,
      })
      clearTimeout(t)
      if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
      const idsLote = lote.cupons.map((c) => idPorCupom.get(c.n_id_cupom)).filter((x): x is number => x != null)
      await supabase.from('vendas_proprio').update({ frio_enviado_em: new Date().toISOString() }).in('id', idsLote)
      enviadas += idsLote.length
    } catch (e) {
      console.error('fechamento: falha ao gravar fato no Contabo (fica pendente para reenvio)', e)
      return { enviadas, pendentes: vendas.length - enviadas, erro: e instanceof Error ? e.message : String(e) }
    }
  }
  return { enviadas, pendentes: vendas.length - enviadas }
}

export async function registrarFechamento(supabase: SupabaseClient, lojaId: number, body: FechamentoBody): Promise<ResultadoFechamento> {
  const rpc = body.cancelado && !(body.itens?.length)
    ? await supabase.rpc('cancelar_venda_proprio', { p_loja: lojaId, p_ref: body.pedidoRef })
    : await supabase.rpc('registrar_venda_proprio', { p_loja: lojaId, p_venda: body })
  if (rpc.error) return { ok: false, frio: 'pendente', erro: rpc.error.message }
  const r = rpc.data as { venda_id?: number; n_id_cupom?: number; duplicado?: boolean; encontrada?: boolean }
  if (r.venda_id == null) return { ok: true, duplicado: false, frio: frioConfigurado() ? 'pendente' : 'desligado' }
  if (!frioConfigurado()) return { ok: true, venda_id: r.venda_id, n_id_cupom: r.n_id_cupom, duplicado: r.duplicado, frio: 'desligado' }
  const envio = await enviarFatoFrio(supabase, lojaId, { vendaIds: [r.venda_id] })
  return { ok: true, venda_id: r.venda_id, n_id_cupom: r.n_id_cupom, duplicado: r.duplicado, frio: envio.enviadas > 0 ? 'enviado' : 'pendente' }
}
