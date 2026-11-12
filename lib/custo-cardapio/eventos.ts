import 'server-only'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { linhasDoCardapio, type BaseCusto, type LinhaPrato } from './carregar'
import { saldosDaLoja } from './saldos'
import { reservasDeEventos, type Reservas } from './reservas'
import { hojeBahiaISO } from '@/lib/data-bahia'
import {
  coberturaCompras, explodirEvento, lerConsumoReal, limitarFolga, listaDeCompras, listaDeProducao, pedidosDoEvento, porcoesNoEvento, resumoEvento, STATUS_EVENTO,
  type Cobertura, type InfoProduto, type LinhaCompra, type LinhaConsumo, type LinhaProducao, type ResumoEvento, type StatusEvento,
} from './eventos-puro'

// Norte Cozinha, Eventos: leitura (RLS), conta do evento e as listas de produção e de compras. Gravação só em lib/actions/cozinha-eventos.ts.

export type EventoRow = {
  id: number; nome: string; data_evento: string | null; convidados: number; status: StatusEvento
  preco_por_pessoa: number | null; obs: string | null; created_at: string; updated_at: string
  /** Folga de produção em % (0 a 200). */
  folga_pct: number
  finalizado_em: string | null; finalizado_por: string | null
  /** Consumo real lançado ao finalizar (insumo → quantidade). */
  consumo_real: Map<number, number> | null
  baixa_ref: string | null
}
type EventoDb = Omit<EventoRow, 'preco_por_pessoa' | 'status' | 'folga_pct' | 'consumo_real'> & {
  preco_por_pessoa: number | string | null; status: string; folga_pct: number | string | null; consumo_real: unknown
}
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

const SELECT_EVENTO = 'id, nome, data_evento, convidados, status, preco_por_pessoa, obs, created_at, updated_at, folga_pct, finalizado_em, finalizado_por, consumo_real, baixa_ref'

function lerEvento(r: EventoDb): EventoRow {
  const preco = r.preco_por_pessoa == null ? null : Number(r.preco_por_pessoa)
  return {
    ...r, id: Number(r.id), convidados: Number(r.convidados), data_evento: r.data_evento ? String(r.data_evento).slice(0, 10) : null,
    status: (STATUS_EVENTO as readonly string[]).includes(r.status) ? (r.status as StatusEvento) : 'orcamento',
    preco_por_pessoa: preco != null && Number.isFinite(preco) ? preco : null,
    folga_pct: limitarFolga(Number(r.folga_pct ?? 0)), consumo_real: lerConsumoReal(r.consumo_real),
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
  ...e, itens, resumo: resumoEvento(e.convidados, itens, base.taxas.metaCmv, e.preco_por_pessoa, e.folga_pct),
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
  cobertura: Cobertura
  folgaPct: number
  semFicha: string[]
  ciclo: boolean
  /** Data da foto de saldo (Omie) ou null (estoque próprio, ao vivo). */
  dataSaldo: string | null
  /** Insumos cuja unidade na ficha difere da do estoque (saldo não descontado). */
  unidadeDiferente: number
  /** Outros eventos confirmados que reservam insumos agora. */
  outrosEventos: number
}

function infoDe(base: BaseCusto) {
  return (cod: number): InfoProduto => {
    const p = base.produtos.get(cod)
    return { descricao: p?.descricao ?? `Produto ${cod}`, unidade: base.unidadeNaFicha.get(cod) ?? p?.unidade?.toUpperCase() ?? null, familia: p?.familia ?? null }
  }
}

/** Saldo só é comparável quando a ficha usa a mesma unidade do estoque (no Omie a ficha pode ter unidade própria). */
function saldoComparavel(base: BaseCusto, porProduto: Map<number, { saldo: number }>, aoDivergir?: () => void) {
  return (cod: number): number | undefined => {
    const naFicha = base.unidadeNaFicha.get(cod)
    const doEstoque = base.produtos.get(cod)?.unidade?.toUpperCase()
    if (naFicha && doEstoque && naFicha !== doEstoque) { aoDivergir?.(); return undefined }
    return porProduto.get(cod)?.saldo ?? 0
  }
}

/** Reservas de outros eventos para um insumo, tirando o próprio evento. */
const reservaDeOutros = (r: Reservas, eventoId: number) => (cod: number) => {
  const eventos = (r.porInsumo.get(cod) ?? []).filter((x) => x.eventoId !== eventoId)
  return eventos.length ? { total: eventos.reduce((a, x) => a + x.quantidade, 0), eventos } : undefined
}

const pedidosSalvos = (e: EventoComConta) =>
  pedidosDoEvento(e.convidados, e.itens.filter((i) => !i.semFicha), e.folga_pct)

/** Explode o evento salvo nas listas de produção e de compras (com folga; saldo atual menos o que outros eventos reservaram). */
export async function listasDoEvento(base: BaseCusto, e: EventoComConta): Promise<ListasEvento> {
  const ex = explodirEvento(base.fichas, base.cmc, pedidosSalvos(e))
  const [saldos, reservas] = await Promise.all([saldosDaLoja(base.lojaId, base.modo), reservasDeEventos(base, e.id)])
  const info = infoDe(base)
  let unidadeDiferente = 0
  const compras = listaDeCompras(ex.insumos, info, saldoComparavel(base, saldos.porProduto, () => { unidadeDiferente++ }), reservaDeOutros(reservas, e.id))
  const producao = listaDeProducao(ex.preparacoes, (cod) => ({ ...info(cod), unidade: base.produtos.get(cod)?.unidade?.toUpperCase() ?? null }),
    (cod) => saldos.porProduto.get(cod)?.saldo ?? 0)
  return {
    pratos: e.itens.filter((i) => !i.semFicha).map((i) => ({ codigo: i.codigo, descricao: i.descricao, porcoes: porcoesNoEvento(e.convidados, i.porcoesPorConvidado), unidade: i.unidade })),
    producao, compras, cobertura: coberturaCompras(compras), folgaPct: e.folga_pct,
    semFicha: e.itens.filter((i) => i.semFicha).map((i) => i.descricao), ciclo: ex.ciclo, dataSaldo: saldos.data, unidadeDiferente,
    outrosEventos: reservas.eventos.length,
  }
}

/** Evento que ainda vai acontecer e precisa de estoque: orçamento ou confirmado, não finalizado, de hoje em diante (ou sem data). */
export const eventoEmAberto = (e: EventoRow) =>
  (e.status === 'orcamento' || e.status === 'confirmado') && !e.finalizado_em && (e.data_evento == null || e.data_evento >= hojeBahiaISO())

/** Para a lista: cobertura dos insumos de cada evento em aberto (uma leitura de saldo e de reservas para todos). */
export async function coberturaDosEventos(base: BaseCusto, eventos: EventoComConta[]): Promise<Map<number, Cobertura>> {
  const out = new Map<number, Cobertura>()
  const abertos = eventos.filter((e) => eventoEmAberto(e) && e.itens.some((i) => !i.semFicha))
  if (!abertos.length) return out
  const [saldos, reservas] = await Promise.all([saldosDaLoja(base.lojaId, base.modo), reservasDeEventos(base, null)])
  const info = infoDe(base)
  const saldo = saldoComparavel(base, saldos.porProduto)
  for (const e of abertos) {
    const ex = explodirEvento(base.fichas, base.cmc, pedidosSalvos(e))
    out.set(e.id, coberturaCompras(listaDeCompras(ex.insumos, info, saldo, reservaDeOutros(reservas, e.id))))
  }
  return out
}

/** Linhas do consumo: previsto (com folga, pela ficha de hoje) e usado. Finalizado = os insumos gravados no consumo real. */
export function linhasDeConsumo(base: BaseCusto, e: EventoRow, compras: LinhaCompra[]): LinhaConsumo[] {
  const porCodigo = new Map(compras.map((c) => [c.codigo, c]))
  const info = infoDe(base)
  const codigos = e.consumo_real ? [...e.consumo_real.keys()] : compras.map((c) => c.codigo)
  return codigos.map((cod) => {
    const c = porCodigo.get(cod)
    const i = info(cod)
    return {
      codigo: cod, codigoTexto: base.produtos.get(cod)?.codigoTexto ?? String(cod), descricao: c?.descricao ?? i.descricao, unidade: c?.unidade ?? i.unidade,
      previsto: c?.bruta ?? 0, usado: e.consumo_real?.get(cod) ?? c?.bruta ?? 0,
    }
  }).sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
}

/** Insumos esperados no consumo do evento salvo (para validar o que a tela manda). */
export function insumosDoEvento(base: BaseCusto, e: EventoComConta): Set<number> {
  return new Set(explodirEvento(base.fichas, base.cmc, pedidosSalvos(e)).insumos.keys())
}

export type LocalBaixa = { codigo: number; descricao: string }

/**
 * Locais de onde a baixa do evento pode sair (estoque próprio). Padrão = o local da cozinha da loja
 * (`lojas.local_estoque_cozinha_codigo`, o mesmo da baixa das vendas da cozinha), senão o local padrão, senão o primeiro.
 * Leitura com service client (a coluna da cozinha não tem grant para a sessão), sempre filtrada pela loja.
 */
export async function locaisDeBaixa(lojaId: number): Promise<{ locais: LocalBaixa[]; padrao: number | null }> {
  const sb = createServiceClient()
  const [{ data: locs }, { data: loja }] = await Promise.all([
    sb.from('local_estoques').select('codigo_local_estoque, descricao, padrao, inativo').eq('loja_id', lojaId).is('deleted_at', null).order('descricao'),
    sb.from('lojas').select('local_estoque_cozinha_codigo').eq('id', lojaId).maybeSingle(),
  ])
  type L = { codigo_local_estoque: number; descricao: string | null; padrao: string | null; inativo: string | null }
  const ativos = ((locs ?? []) as L[]).filter((l) => (l.inativo ?? 'N') !== 'S')
  const locais = ativos.map((l) => ({ codigo: Number(l.codigo_local_estoque), descricao: l.descricao || `Local ${l.codigo_local_estoque}` }))
  const cozinha = Number((loja as { local_estoque_cozinha_codigo?: number | null } | null)?.local_estoque_cozinha_codigo ?? 0)
  const padrao = locais.find((l) => l.codigo === cozinha)?.codigo
    ?? ativos.find((l) => l.padrao === 'S')?.codigo_local_estoque
    ?? locais[0]?.codigo ?? null
  return { locais, padrao: padrao == null ? null : Number(padrao) }
}
