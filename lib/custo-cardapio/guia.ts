import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { arvoreCustoFicha, type NoArvore } from '@/lib/estoque/arvore-custo-puro'
import { ehPreparacao, type BaseCusto } from './carregar'
import { qtd } from './formato'
import { infosDaLoja, type InfoReceita } from './receita-info'
import { formatarTempo, lerContexto, passosDoTexto, porcoesCardapio, porcoesEvento, preparacoesNecessarias, type NoQtd } from './guia-puro'

// Norte Cozinha, Guia de preparo: a visão da cozinha (sem custo). Lista de pratos e preparações com ficha,
// filtrada por evento ou cardápio (quantidades escaladas), e a receita escolhida com a árvore da ficha
// (arvoreCustoFicha) já na quantidade do contexto. Só leitura (RLS).

export type NoGuia = { codigo: number; descricao: string; unidade: string | null; quantidade: number; temFicha: boolean; filhos: NoGuia[] }

export type ItemGuia = {
  codigo: number
  codigoTexto: string
  descricao: string
  familia: string | null
  tipo: 'prato' | 'preparacao'
  fotoUrl: string | null
  temPreparo: boolean
  /** Quantidade do contexto (porções do prato ou quantidade da preparação na unidade dela); null = sem contexto. */
  quantidade: number | null
  rotuloQtd: string | null
}

export type OpcaoContexto = { chave: string; tipo: 'evento' | 'cardapio'; nome: string; sub: string }
export type ContextoAtivo = OpcaoContexto & { detalhe: string }

export type ReceitaGuia = {
  codigo: number
  descricao: string
  tipo: 'prato' | 'preparacao'
  unidade: string | null
  /** Quantidade da receita mostrada (na unidade do produto: porções para prato). */
  quantidade: number
  rotuloQtd: string
  /** De onde veio a quantidade. */
  base: 'contexto' | 'manual' | 'padrao'
  filhos: NoGuia[]
  ciclo: boolean
  fotoUrl: string | null
  passos: string[]
  observacoes: string | null
  tempo: string | null
  rendimento: string | null
  /** Preparo das preparações que aparecem na árvore. */
  subs: Record<number, { passos: string[]; observacoes: string | null; tempo: string | null; rendimento: string | null }>
}

const unidadeDe = (b: BaseCusto, cod: number) => b.unidadeNaFicha.get(cod) ?? b.produtos.get(cod)?.unidade?.toUpperCase() ?? null
const tipoDe = (b: BaseCusto, cod: number): 'prato' | 'preparacao' => (ehPreparacao(b.produtos.get(cod)) ? 'preparacao' : 'prato')
const nomeDe = (b: BaseCusto, cod: number) => b.produtos.get(cod)?.descricao ?? `Produto ${cod}`

export function rotuloQuantidade(b: BaseCusto, cod: number, q: number): string {
  if (tipoDe(b, cod) === 'prato') {
    const n = q.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
    return `${n} ${q === 1 ? 'porção' : 'porções'}`
  }
  return qtd(q, unidadeDe(b, cod))
}

function vestir(b: BaseCusto, nos: NoArvore[]): NoGuia[] {
  return nos.map((n) => ({ codigo: n.codigo, descricao: nomeDe(b, n.codigo), unidade: unidadeDe(b, n.codigo), quantidade: n.quantidade, temFicha: n.temFicha, filhos: vestir(b, n.filhos) }))
}

/** Quantidade padrão sem contexto: 1 porção do prato; a receita inteira (rendimento da ficha) da preparação. */
export function quantidadePadrao(b: BaseCusto, cod: number): number {
  if (tipoDe(b, cod) === 'prato') return 1
  const r = b.fichas.get(cod)?.rendimento
  return r && r > 0 ? r : 1
}

type EventoDb = { id: number; nome: string; data_evento: string | null; convidados: number; folga_pct: number | string | null; status: string }
type CardapioDb = { id: number; nome: string; canal: string }

const dataBR = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : 'sem data')

/** Eventos (não cancelados; passados só se pedido) e cardápios ativos da loja. */
export async function opcoesDeContexto(lojaId: number, incluirPassados: boolean): Promise<OpcaoContexto[]> {
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const [{ data: evs }, { data: cards }] = await Promise.all([
    supabase.from('custo_eventos').select('id, nome, data_evento, convidados, folga_pct, status').eq('loja_id', lojaId).neq('status', 'cancelado')
      .order('data_evento', { ascending: true, nullsFirst: false }).order('id').limit(300),
    supabase.from('custo_cardapios').select('id, nome, canal').eq('loja_id', lojaId).eq('ativo', true).order('nome').limit(300),
  ])
  const eventos = ((evs ?? []) as EventoDb[])
    .filter((e) => incluirPassados || !e.data_evento || String(e.data_evento).slice(0, 10) >= hoje)
    .map((e): OpcaoContexto => ({ chave: `e${e.id}`, tipo: 'evento', nome: e.nome, sub: `${dataBR(e.data_evento ? String(e.data_evento).slice(0, 10) : null)} · ${Number(e.convidados)} convidados` }))
  const cardapios = ((cards ?? []) as CardapioDb[]).map((c): OpcaoContexto => ({ chave: `c${c.id}`, tipo: 'cardapio', nome: c.nome, sub: c.canal === 'delivery' ? 'Delivery' : 'Salão' }))
  return [...eventos, ...cardapios]
}

/** Porções de cada item do evento/cardápio (somadas se o prato aparece mais de uma vez). */
async function pedidosDoContexto(b: BaseCusto, chave: string): Promise<{ ativo: ContextoAtivo; pedidos: Map<number, number> } | null> {
  const c = lerContexto(chave)
  if (!c) return null
  const supabase = await createClient()
  const pedidos = new Map<number, number>()
  const somar = (cod: number, q: number) => { if (q > 0) pedidos.set(cod, (pedidos.get(cod) ?? 0) + q) }
  if (c.tipo === 'evento') {
    const { data: e } = await supabase.from('custo_eventos').select('id, nome, data_evento, convidados, folga_pct, status')
      .eq('loja_id', b.lojaId).eq('id', c.id).maybeSingle()
    if (!e) return null
    const ev = e as EventoDb
    const folga = Number(ev.folga_pct ?? 0) || 0
    type It = { codigo_produto: number; porcoes_por_convidado: number | string }
    const itens = await buscarTodasLinhas<It>((from, to) =>
      supabase.from('custo_evento_itens').select('id, codigo_produto, porcoes_por_convidado').eq('loja_id', b.lojaId).eq('evento_id', c.id)
        .order('id').range(from, to) as unknown as PromiseLike<{ data: It[] | null; error: { message: string } | null }>)
    for (const i of itens) somar(Number(i.codigo_produto), porcoesEvento(Number(ev.convidados), Number(i.porcoes_por_convidado), folga))
    const data = ev.data_evento ? String(ev.data_evento).slice(0, 10) : null
    return {
      ativo: {
        chave, tipo: 'evento', nome: ev.nome, sub: `${dataBR(data)} · ${Number(ev.convidados)} convidados`,
        detalhe: `${Number(ev.convidados)} convidados${folga > 0 ? `, com folga de ${folga.toLocaleString('pt-BR')}%` : ''}`,
      },
      pedidos,
    }
  }
  const { data: card } = await supabase.from('custo_cardapios').select('id, nome, canal').eq('loja_id', b.lojaId).eq('id', c.id).maybeSingle()
  if (!card) return null
  type It = { codigo_produto: number; porcoes?: number | string | null }
  let itens: It[] = []
  let erroPorcoes = false
  itens = await buscarTodasLinhas<It>((from, to) =>
    supabase.from('custo_cardapio_itens').select('id, codigo_produto, porcoes').eq('loja_id', b.lojaId).eq('cardapio_id', c.id)
      .order('id').range(from, to) as unknown as PromiseLike<{ data: It[] | null; error: { message: string } | null }>, undefined, () => { erroPorcoes = true })
  if (erroPorcoes && !itens.length) {
    // Base sem a coluna porcoes (migration 474 ausente): 1 porção por item.
    itens = await buscarTodasLinhas<It>((from, to) =>
      supabase.from('custo_cardapio_itens').select('id, codigo_produto').eq('loja_id', b.lojaId).eq('cardapio_id', c.id)
        .order('id').range(from, to) as unknown as PromiseLike<{ data: It[] | null; error: { message: string } | null }>)
  }
  for (const i of itens) somar(Number(i.codigo_produto), porcoesCardapio(i.porcoes))
  const cd = card as CardapioDb
  return { ativo: { chave, tipo: 'cardapio', nome: cd.nome, sub: cd.canal === 'delivery' ? 'Delivery' : 'Salão', detalhe: 'porções previstas no cardápio' }, pedidos }
}

/** Quantidade de cada receita no contexto: os itens pedidos + as preparações que eles usam (somadas). */
function quantidadesDoContexto(b: BaseCusto, pedidos: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>()
  const arvores: NoQtd[][] = []
  for (const [cod, q] of pedidos) {
    if (!b.fichas.has(cod)) continue
    out.set(cod, q)
    const a = arvoreCustoFicha(b.fichas, b.cmc, cod, q)
    if (a) arvores.push(a.filhos)
  }
  for (const [cod, q] of preparacoesNecessarias(arvores)) out.set(cod, Math.round(((out.get(cod) ?? 0) + q) * 1e6) / 1e6)
  return out
}

export type DadosGuia = {
  itens: ItemGuia[]
  contextos: OpcaoContexto[]
  ativo: ContextoAtivo | null
  /** O contexto pedido na URL não existe (ou é de outra loja). */
  contextoInvalido: boolean
  receita: ReceitaGuia | null
}

export async function carregarGuia(b: BaseCusto, opts: { ctx: string | null; produto: number | null; base: number | null; passados: boolean }): Promise<DadosGuia> {
  const [infos, contextos, doCtx] = await Promise.all([
    infosDaLoja(b.lojaId),
    opcoesDeContexto(b.lojaId, opts.passados),
    opts.ctx ? pedidosDoContexto(b, opts.ctx) : Promise.resolve(null),
  ])
  const qtdCtx = doCtx ? quantidadesDoContexto(b, doCtx.pedidos) : null
  const codigos = qtdCtx ? [...qtdCtx.keys()] : [...b.fichas.keys()].filter((c) => !b.produtos.get(c)?.inativo)
  const itens: ItemGuia[] = codigos.map((cod) => {
    const p = b.produtos.get(cod)
    const info = infos.get(cod)
    const q = qtdCtx?.get(cod) ?? null
    return {
      codigo: cod, codigoTexto: p?.codigoTexto ?? String(cod), descricao: nomeDe(b, cod), familia: p?.familia ?? null, tipo: tipoDe(b, cod),
      fotoUrl: info?.fotoUrl ?? null, temPreparo: !!info?.modoPreparo, quantidade: q, rotuloQtd: q != null ? rotuloQuantidade(b, cod, q) : null,
    }
  }).sort((x, y) => (x.tipo === y.tipo ? 0 : x.tipo === 'prato' ? -1 : 1) || x.descricao.localeCompare(y.descricao, 'pt-BR'))

  let receita: ReceitaGuia | null = null
  if (opts.produto != null && b.fichas.has(opts.produto)) {
    const cod = opts.produto
    const doContexto = qtdCtx?.get(cod)
    const [quantidade, base]: [number, ReceitaGuia['base']] = opts.base != null ? [opts.base, 'manual'] : doContexto != null ? [doContexto, 'contexto'] : [quantidadePadrao(b, cod), 'padrao']
    const a = arvoreCustoFicha(b.fichas, b.cmc, cod, quantidade)
    if (a) {
      const filhos = vestir(b, a.filhos)
      const subs: ReceitaGuia['subs'] = {}
      const coletar = (nos: NoGuia[]) => {
        for (const n of nos) {
          const i = n.temFicha ? infos.get(n.codigo) : undefined
          if (i && !subs[n.codigo]) subs[n.codigo] = { passos: passosDoTexto(i.modoPreparo), observacoes: i.observacoes, tempo: formatarTempo(i.tempoPreparoMin), rendimento: i.rendimentoTexto }
          coletar(n.filhos)
        }
      }
      coletar(filhos)
      const info: InfoReceita | undefined = infos.get(cod)
      receita = {
        codigo: cod, descricao: nomeDe(b, cod), tipo: tipoDe(b, cod), unidade: unidadeDe(b, cod), quantidade, rotuloQtd: rotuloQuantidade(b, cod, quantidade), base,
        filhos, ciclo: a.ciclo, fotoUrl: info?.fotoUrl ?? null, passos: passosDoTexto(info?.modoPreparo), observacoes: info?.observacoes ?? null,
        tempo: formatarTempo(info?.tempoPreparoMin), rendimento: info?.rendimentoTexto ?? null, subs,
      }
    }
  }
  return { itens, contextos, ativo: doCtx?.ativo ?? null, contextoInvalido: !!opts.ctx && !doCtx, receita }
}
