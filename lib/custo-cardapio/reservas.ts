import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { BaseCusto } from './carregar'
import { explodirEvento, porcoesNoEvento } from './eventos-puro'
import { hojeBahiaISO } from '@/lib/data-bahia'

// Reserva de estoque por evento (como o "reservar insumos" do Kitchen Sense, mas calculada, sem tabela):
// todo evento CONFIRMADO, não finalizado, com data de hoje em diante, reserva os insumos que vai consumir
// (explosão da ficha × porções × (1 + folga)). Ninguém grava reserva: muda o evento, muda a reserva.

export type ReservaEvento = { eventoId: number; nome: string; data: string | null; quantidade: number }
export type Reservas = {
  /** insumo → total reservado (unidade do estoque) */
  total: Map<number, number>
  /** insumo → por evento */
  porInsumo: Map<number, ReservaEvento[]>
  eventos: { id: number; nome: string; data: string | null }[]
}

type Ev = { id: number; nome: string; data_evento: string | null; convidados: number; folga_pct: number | string | null }
type It = { evento_id: number; codigo_produto: number; porcoes_por_convidado: number | string }

/** Reservas da loja; `excetoEvento` tira um evento da conta (para mostrar "o que OUTROS eventos reservaram"). */
export const reservasDeEventos = cache(async (base: BaseCusto, excetoEvento: number | null = null): Promise<Reservas> => {
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const { data: evs } = await supabase.from('custo_eventos').select('id, nome, data_evento, convidados, folga_pct')
    .eq('loja_id', base.lojaId).eq('status', 'confirmado').is('finalizado_em', null)
    .or(`data_evento.gte.${hoje},data_evento.is.null`).order('id').limit(200)
  const eventos = ((evs ?? []) as Ev[]).filter((e) => e.id !== excetoEvento)
  const total = new Map<number, number>()
  const porInsumo = new Map<number, ReservaEvento[]>()
  if (!eventos.length) return { total, porInsumo, eventos: [] }
  const { data: its } = await supabase.from('custo_evento_itens').select('evento_id, codigo_produto, porcoes_por_convidado')
    .eq('loja_id', base.lojaId).in('evento_id', eventos.map((e) => e.id)).order('id').limit(5000)
  for (const e of eventos) {
    const folga = 1 + Number(e.folga_pct ?? 0) / 100
    const pedidos = ((its ?? []) as It[]).filter((i) => i.evento_id === e.id)
      .map((i) => ({ codigo: Number(i.codigo_produto), porcoes: porcoesNoEvento(e.convidados, Number(i.porcoes_por_convidado)) * folga }))
    const ex = explodirEvento(base.fichas, base.cmc, pedidos)
    for (const [cod, n] of ex.insumos) {
      total.set(cod, (total.get(cod) ?? 0) + n.quantidade)
      const l = porInsumo.get(cod) ?? []
      l.push({ eventoId: e.id, nome: e.nome, data: e.data_evento, quantidade: n.quantidade })
      porInsumo.set(cod, l)
    }
  }
  return { total, porInsumo, eventos: eventos.map((e) => ({ id: e.id, nome: e.nome, data: e.data_evento })) }
})
