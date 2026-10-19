import { createClient } from '@/lib/supabase/server'
import type { EtapaRequisicao } from '@/lib/compras/requisicao-puro'

// Leitura das requisições de compra (sessão do usuário: RLS por loja). Só loja de estoque próprio (migration 240).

export type ItemRequisicao = {
  id: number; linha: number; codigoProduto: number; descricao: string; unidade: string | null; fator: number; quantidade: number; precoSugerido: number
  fornecedorId: number | null; fornecedorNome: string | null; fornecedorCnpj: string | null; obs: string | null; pedidoId: number | null
}
export type RequisicaoResumo = {
  id: number; numero: number; etapa: EtapaRequisicao; sugestaoEntrega: string | null; compradorId: number | null; origem: string
  obs: string | null; obsInterna: string | null; criadoPorNome: string | null; aprovadoPorNome: string | null; aprovadoEm: string | null
  recusadoPorNome: string | null; recusadoEm: string | null; motivoRecusa: string | null; createdAt: string; updatedAt: string
  itens: ItemRequisicao[]; valor: number
}
export type EventoRequisicao = { id: number; tipo: string; de: string | null; para: string | null; detalhe: Record<string, unknown>; userNome: string | null; em: string }

const n = (v: unknown) => Number(v ?? 0) || 0
const COLS = 'id, numero, etapa, sugestao_entrega, comprador_id, origem, obs, obs_interna, criado_por_nome, aprovado_por_nome, aprovado_em, recusado_por_nome, recusado_em, motivo_recusa, created_at, updated_at'

function itemDe(r: Record<string, unknown>): ItemRequisicao {
  return {
    id: n(r.id), linha: n(r.linha), codigoProduto: n(r.codigo_produto), descricao: String(r.descricao ?? ''), unidade: (r.unidade as string) ?? null,
    fator: n(r.fator) || 1, quantidade: n(r.quantidade), precoSugerido: n(r.preco_sugerido), fornecedorId: r.fornecedor_id == null ? null : n(r.fornecedor_id),
    fornecedorNome: (r.fornecedor_nome as string) ?? null, fornecedorCnpj: (r.fornecedor_cnpj as string) ?? null, obs: (r.obs as string) ?? null,
    pedidoId: r.pedido_id == null ? null : n(r.pedido_id),
  }
}

function montar(c: Record<string, unknown>, itens: ItemRequisicao[]): RequisicaoResumo {
  return {
    id: n(c.id), numero: n(c.numero), etapa: c.etapa as EtapaRequisicao, sugestaoEntrega: (c.sugestao_entrega as string) ?? null,
    compradorId: c.comprador_id == null ? null : n(c.comprador_id), origem: String(c.origem ?? 'manual'), obs: (c.obs as string) ?? null,
    obsInterna: (c.obs_interna as string) ?? null, criadoPorNome: (c.criado_por_nome as string) ?? null, aprovadoPorNome: (c.aprovado_por_nome as string) ?? null,
    aprovadoEm: (c.aprovado_em as string) ?? null, recusadoPorNome: (c.recusado_por_nome as string) ?? null, recusadoEm: (c.recusado_em as string) ?? null,
    motivoRecusa: (c.motivo_recusa as string) ?? null, createdAt: String(c.created_at), updatedAt: String(c.updated_at), itens,
    valor: Math.round(itens.reduce((a, i) => a + i.quantidade * i.precoSugerido, 0) * 100) / 100,
  }
}

/** As 300 requisições mais recentes, com os itens. erro = migration 240 ainda não aplicada. */
export async function listarRequisicoes(lojaId: number): Promise<{ requisicoes: RequisicaoResumo[]; erro: string | null }> {
  const sb = await createClient()
  const { data, error } = await sb.from('requisicoes_compra').select(COLS).eq('loja_id', lojaId).order('numero', { ascending: false }).limit(300)
  if (error) return { requisicoes: [], erro: 'Requisições de compra ainda não ativadas nesta instalação (migration 240).' }
  const cabs = (data ?? []) as Record<string, unknown>[]
  const ids = cabs.map((c) => n(c.id))
  const itens = new Map<number, ItemRequisicao[]>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data: its } = await sb.from('requisicoes_compra_itens').select('*').eq('loja_id', lojaId).in('requisicao_id', ids.slice(i, i + 100)).order('id').limit(10000)
    for (const r of (its ?? []) as Record<string, unknown>[]) itens.set(n(r.requisicao_id), [...(itens.get(n(r.requisicao_id)) ?? []), itemDe(r)])
  }
  return { requisicoes: cabs.map((c) => montar(c, itens.get(n(c.id)) ?? [])), erro: null }
}

export async function carregarRequisicao(lojaId: number, id: number): Promise<{
  req: RequisicaoResumo; eventos: EventoRequisicao[]; codigos: Map<number, string>; pedidos: { id: number; numero: number; fornecedor: string }[]
} | null> {
  const sb = await createClient()
  const { data: c } = await sb.from('requisicoes_compra').select(COLS).eq('loja_id', lojaId).eq('id', id).maybeSingle()
  if (!c) return null
  const [{ data: its }, { data: evs }] = await Promise.all([
    sb.from('requisicoes_compra_itens').select('*').eq('loja_id', lojaId).eq('requisicao_id', id).order('linha'),
    sb.from('requisicoes_compra_eventos').select('id, tipo, de_etapa, para_etapa, detalhe, user_nome, created_at').eq('loja_id', lojaId).eq('requisicao_id', id).order('id'),
  ])
  const itens = ((its ?? []) as Record<string, unknown>[]).map(itemDe)
  const codigos = new Map<number, string>()
  if (itens.length) {
    const { data: ps } = await sb.from('produtos').select('codigo_produto, codigo').eq('loja_id', lojaId).in('codigo_produto', [...new Set(itens.map((i) => i.codigoProduto))])
    for (const p of ps ?? []) codigos.set(n(p.codigo_produto), p.codigo)
  }
  const idsPed = [...new Set(itens.map((i) => i.pedidoId).filter((x): x is number => x != null))]
  let pedidos: { id: number; numero: number; fornecedor: string }[] = []
  if (idsPed.length) {
    const { data: ps } = await sb.from('pedidos_compra').select('id, numero, fornecedor_nome').eq('loja_id', lojaId).in('id', idsPed).order('numero')
    pedidos = (ps ?? []).map((p) => ({ id: n(p.id), numero: n(p.numero), fornecedor: p.fornecedor_nome }))
  }
  return {
    req: montar(c as Record<string, unknown>, itens), codigos, pedidos,
    eventos: (evs ?? []).map((e) => ({ id: n(e.id), tipo: e.tipo, de: e.de_etapa, para: e.para_etapa, detalhe: (e.detalhe ?? {}) as Record<string, unknown>, userNome: e.user_nome, em: e.created_at })),
  }
}
