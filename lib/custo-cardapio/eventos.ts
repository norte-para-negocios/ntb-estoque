import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { linhasDoCardapio, type BaseCusto, type LinhaPrato } from './carregar'
import { saldosDaLoja } from './saldos'
import {
  explodirEvento, listaDeCompras, listaDeProducao, porcoesNoEvento, resumoEvento, STATUS_EVENTO,
  type InfoProduto, type LinhaCompra, type LinhaProducao, type ResumoEvento, type StatusEvento,
} from './eventos-puro'

// Norte Cozinha, Eventos: leitura (RLS), conta do evento e as listas de produção e de compras. Gravação só em lib/actions/cozinha-eventos.ts.

export type EventoRow = {
  id: number; nome: string; data_evento: string | null; convidados: number; status: StatusEvento
  preco_por_pessoa: number | null; obs: string | null; created_at: string; updated_at: string
}
type EventoDb = Omit<EventoRow, 'preco_por_pessoa' | 'status'> & { preco_por_pessoa: number | string | null; status: string }
type ItemRow = { id: number; evento_id: number; codigo_produto: number; porcoes_por_convidado: number | string; ordem: number }

export type ItemEventoTela = {
  itemId: number
  codigo: number
  codigoTexto: string
  descricao: string
  familia: string | null
  tipo: 'prato' | 'preparacao'
  unidade: string | null
  porcoesPorConvidado: number
  /** Custo de 1 porção pela ficha. */
  custoPorPorcao: number
  semCusto: number
  suspeitos: number
  semFicha: boolean
}

export type EventoComConta = EventoRow & { itens: ItemEventoTela[]; resumo: ResumoEvento }

const SELECT_EVENTO = 'id, nome, data_evento, convidados, status, preco_por_pessoa, obs, created_at, updated_at'

function lerEvento(r: EventoDb): EventoRow {
  const preco = r.preco_por_pessoa == null ? null : Number(r.preco_por_pessoa)
  return {
    ...r, id: Number(r.id), convidados: Number(r.convidados), data_evento: r.data_evento ? String(r.data_evento).slice(0, 10) : null,
    status: (STATUS_EVENTO as readonly string[]).includes(r.status) ? (r.status as StatusEvento) : 'orcamento',
    preco_por_pessoa: preco != null && Number.isFinite(preco) ? preco : null,
  }
}

function montarItens(base: BaseCusto, porCodigo: Map<number, LinhaPrato>, rows: ItemRow[]): ItemEventoTela[] {
  return [...rows].sort((a, b) => a.ordem - b.ordem || a.id - b.id).map((r) => {
    const cod = Number(r.codigo_produto)
    const l = porCodigo.get(cod)
    const p = base.produtos.get(cod)
    return {
      itemId: Number(r.id), codigo: cod, codigoTexto: l?.codigoTexto ?? p?.codigoTexto ?? String(cod),
      descricao: l?.descricao ?? p?.descricao ?? `Produto ${cod}`, familia: l?.familia ?? p?.familia ?? null,
      tipo: l?.tipo ?? 'prato', unidade: p?.unidade ?? null, porcoesPorConvidado: Number(r.porcoes_por_convidado),
      custoPorPorcao: l?.custo ?? 0, semCusto: l?.semCusto ?? 0, suspeitos: l?.suspeitos ?? 0, semFicha: !l,
    }
  })
}

const comConta = (e: EventoRow, itens: ItemEventoTela[], base: BaseCusto): EventoComConta => ({
  ...e, itens, resumo: resumoEvento(e.convidados, itens, base.taxas.metaCmv, e.preco_por_pessoa),
})

/** Pratos e preparações com ficha que podem entrar num evento. */
export const opcoesDoEvento = (base: BaseCusto): LinhaPrato[] => linhasDoCardapio(base)

export async function listarEventos(base: BaseCusto): Promise<{ eventos: EventoComConta[]; erro: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('custo_eventos').select(SELECT_EVENTO).eq('loja_id', base.lojaId)
    .order('data_evento', { ascending: false, nullsFirst: true }).order('id', { ascending: false })
  if (error) return { eventos: [], erro: error.message }
  let erroItens: string | null = null
  const itens = await buscarTodasLinhas<ItemRow>((from, to) =>
    supabase.from('custo_evento_itens').select('id, evento_id, codigo_produto, porcoes_por_convidado, ordem').eq('loja_id', base.lojaId)
      .order('id').range(from, to) as unknown as PromiseLike<{ data: ItemRow[] | null; error: { message: string } | null }>,
  undefined, (e) => { erroItens = e.message })
  const porCodigo = new Map(linhasDoCardapio(base).map((l) => [l.codigo, l]))
  const porEvento = new Map<number, ItemRow[]>()
  for (const i of itens) porEvento.set(Number(i.evento_id), [...(porEvento.get(Number(i.evento_id)) ?? []), i])
  const eventos = (data ?? []).map((r) => {
    const e = lerEvento(r as EventoDb)
    return comConta(e, montarItens(base, porCodigo, porEvento.get(e.id) ?? []), base)
  })
  return { eventos, erro: erroItens }
}

export async function carregarEvento(base: BaseCusto, id: number): Promise<EventoComConta | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('custo_eventos').select(SELECT_EVENTO).eq('loja_id', base.lojaId).eq('id', id).maybeSingle()
  if (!data) return null
  const { data: itens } = await supabase.from('custo_evento_itens').select('id, evento_id, codigo_produto, porcoes_por_convidado, ordem')
    .eq('loja_id', base.lojaId).eq('evento_id', id).order('ordem').order('id')
  const porCodigo = new Map(linhasDoCardapio(base).map((l) => [l.codigo, l]))
  return comConta(lerEvento(data as EventoDb), montarItens(base, porCodigo, (itens ?? []) as ItemRow[]), base)
}

export type ListasEvento = {
  pratos: { codigo: number; descricao: string; porcoes: number; unidade: string | null }[]
  producao: LinhaProducao[]
  compras: LinhaCompra[]
  semFicha: string[]
  ciclo: boolean
  /** Data da foto de saldo (Omie) ou null (estoque próprio, ao vivo). */
  dataSaldo: string | null
  /** Insumos cuja unidade na ficha difere da do estoque (saldo não descontado). */
  unidadeDiferente: number
}

/** Explode o evento salvo nas listas de produção e de compras (saldo atual descontado). */
export async function listasDoEvento(base: BaseCusto, e: EventoComConta): Promise<ListasEvento> {
  const pedidos = e.itens.filter((i) => !i.semFicha).map((i) => ({ codigo: i.codigo, porcoes: porcoesNoEvento(e.convidados, i.porcoesPorConvidado) }))
  const ex = explodirEvento(base.fichas, base.cmc, pedidos)
  const saldos = await saldosDaLoja(base.lojaId, base.modo)
  const info = (cod: number): InfoProduto => {
    const p = base.produtos.get(cod)
    return { descricao: p?.descricao ?? `Produto ${cod}`, unidade: base.unidadeNaFicha.get(cod) ?? p?.unidade?.toUpperCase() ?? null, familia: p?.familia ?? null }
  }
  let unidadeDiferente = 0
  // Saldo só é comparável quando a ficha usa a mesma unidade do estoque (no Omie a ficha pode ter unidade própria).
  const saldo = (cod: number): number | undefined => {
    const naFicha = base.unidadeNaFicha.get(cod)
    const doEstoque = base.produtos.get(cod)?.unidade?.toUpperCase()
    if (naFicha && doEstoque && naFicha !== doEstoque) { unidadeDiferente++; return undefined }
    return saldos.porProduto.get(cod)?.saldo ?? 0
  }
  const compras = listaDeCompras(ex.insumos, info, saldo)
  const producao = listaDeProducao(ex.preparacoes, (cod) => ({ ...info(cod), unidade: base.produtos.get(cod)?.unidade?.toUpperCase() ?? null }),
    (cod) => saldos.porProduto.get(cod)?.saldo ?? 0)
  return {
    pratos: e.itens.filter((i) => !i.semFicha).map((i) => ({ codigo: i.codigo, descricao: i.descricao, porcoes: porcoesNoEvento(e.convidados, i.porcoesPorConvidado), unidade: i.unidade })),
    producao, compras, semFicha: e.itens.filter((i) => i.semFicha).map((i) => i.descricao), ciclo: ex.ciclo, dataSaldo: saldos.data, unidadeDiferente,
  }
}
