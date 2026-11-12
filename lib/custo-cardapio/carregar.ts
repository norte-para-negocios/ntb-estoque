import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { carregarFichasAtivas } from '@/lib/estoque/receita-db'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { arvoreCustoFicha, type ArvoreCusto, type FichaArvore, type NoArvore } from '@/lib/estoque/arvore-custo-puro'
import { cmcDaFoto, custoSuspeito, lerTaxas, precoReal, precoSugeridoDelivery, precoSugeridoSalao, situacao, sobraPorVenda, type Situacao, type Taxas } from './preco-puro'

// Custo e Cardápio: junta o que o ERP já tem — fichas (Omie: estrutura_produto_cache; próprio: fichas_tecnicas),
// custo médio (Omie: posicao_estoques da foto mais recente; próprio: estoque_custos) e o preço de venda (produtos.valor_unitario,
// que no próprio vem do Norte Vendas). O custo do prato desce sempre pela ficha (arvoreCustoFicha).

export type ProdutoInfo = { codigo: number; codigoTexto: string; descricao: string; unidade: string | null; familia: string | null; tipo: string | null; preco: number | null; inativo: boolean }

export type BaseCusto = {
  lojaId: number
  modo: 'omie' | 'proprio'
  taxas: Taxas
  /** false = migration 473 ainda não aplicada (usa as taxas padrão e não grava). */
  configGravavel: boolean
  fichas: Map<number, FichaArvore>
  cmc: Map<number, number | null>
  produtos: Map<number, ProdutoInfo>
  /** Unidade do insumo na ficha do Omie (a quantidade da ficha está nela). */
  unidadeNaFicha: Map<number, string>
  /** Data da foto do custo (Omie) ou null. */
  dataCusto: string | null
  avisos: string[]
}

async function fichasOmie(lojaId: number) {
  const supabase = await createClient()
  type R = { codigo_produto: number; codigo_produto_insumo: number; quantidade: number; percentual_perda: number | null; unidade: string | null }
  const rows = await buscarTodasLinhas<R>((from, to) =>
    supabase.from('estrutura_produto_cache').select('id, codigo_produto, codigo_produto_insumo, quantidade, percentual_perda, unidade')
      .eq('loja_id', lojaId).order('id').range(from, to) as unknown as PromiseLike<{ data: R[] | null; error: { message: string } | null }>)
  const fichas = new Map<number, FichaArvore>()
  const unidade = new Map<number, string>()
  for (const r of rows) {
    const cod = Number(r.codigo_produto)
    const f = fichas.get(cod) ?? { codigoProduto: cod, rendimento: 1, expandirNaVenda: true, itens: [] }
    f.itens.push({ codigoInsumo: Number(r.codigo_produto_insumo), quantidadeLiquida: Number(r.quantidade), fatorCorrecao: 1, perdaPct: Number(r.percentual_perda ?? 0) })
    fichas.set(cod, f)
    if (r.unidade) unidade.set(Number(r.codigo_produto_insumo), r.unidade.toUpperCase())
  }
  return { fichas, unidade }
}

async function custoOmie(lojaId: number) {
  const supabase = await createClient()
  const { data: foto } = await supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId)
    .order('data_posicao', { ascending: false }).limit(1).maybeSingle()
  if (!foto?.data_posicao) return { cmc: new Map<number, number>(), data: null as string | null }
  type R = { n_cod_prod: number; codigo_local_estoque: number | null; n_cmc: number; n_saldo: number }
  const rows = await buscarTodasLinhas<R>((from, to) =>
    supabase.from('posicao_estoques').select('id, n_cod_prod, codigo_local_estoque, n_cmc, n_saldo')
      .eq('loja_id', lojaId).eq('data_posicao', foto.data_posicao).gt('n_cmc', 0).order('id').range(from, to) as unknown as PromiseLike<{ data: R[] | null; error: { message: string } | null }>)
  const cmc = cmcDaFoto(rows.map((r) => ({ produto: Number(r.n_cod_prod), local: Number(r.codigo_local_estoque ?? 0), cmc: Number(r.n_cmc), saldo: Number(r.n_saldo) })))
  return { cmc, data: String(foto.data_posicao).slice(0, 10) }
}

async function custoProprio(lojaId: number) {
  const supabase = await createClient()
  type R = { codigo_produto: number; cmc: number | null; ultimo_custo: number | null }
  const rows = await buscarTodasLinhas<R>((from, to) =>
    supabase.from('estoque_custos').select('codigo_produto, cmc, ultimo_custo').eq('loja_id', lojaId)
      .order('codigo_produto').range(from, to) as unknown as PromiseLike<{ data: R[] | null; error: { message: string } | null }>)
  const cmc = new Map<number, number>()
  for (const r of rows) {
    const v = Number(r.cmc) > 0 ? Number(r.cmc) : Number(r.ultimo_custo) > 0 ? Number(r.ultimo_custo) : 0
    if (v > 0) cmc.set(Number(r.codigo_produto), v)
  }
  return cmc
}

/** O Omie devolve descrições com entidades HTML (&quot; &amp;). */
const limparTexto = (t: string) => t.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

async function produtosDaLoja(lojaId: number) {
  const supabase = await createClient()
  type R = { codigo_produto: number; codigo: string | null; descricao: string; unidade: string | null; descricao_familia: string | null; tipo_item: string | null; valor_unitario: number | null; inativo: boolean | null }
  const rows = await buscarTodasLinhas<R>((from, to) =>
    supabase.from('produtos').select('id, codigo_produto, codigo, descricao, unidade, descricao_familia, tipo_item, valor_unitario, inativo')
      .eq('loja_id', lojaId).order('id').range(from, to) as unknown as PromiseLike<{ data: R[] | null; error: { message: string } | null }>)
  const m = new Map<number, ProdutoInfo>()
  for (const r of rows) {
    const cod = Number(r.codigo_produto)
    m.set(cod, {
      codigo: cod, codigoTexto: r.codigo ?? String(cod), descricao: limparTexto(r.descricao ?? ''), unidade: r.unidade, familia: r.descricao_familia ? limparTexto(r.descricao_familia).trim() || null : null,
      tipo: r.tipo_item, preco: Number(r.valor_unitario) > 0 ? Number(r.valor_unitario) : null, inativo: !!r.inativo,
    })
  }
  return m
}

export async function carregarTaxas(lojaId: number): Promise<{ taxas: Taxas; gravavel: boolean }> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('custo_cardapio_config').select('meta_cmv, imposto_pct, taxa_cartao_pct, taxa_delivery_pct, embalagem').eq('loja_id', lojaId).maybeSingle()
  if (error) return { taxas: lerTaxas(null), gravavel: false }
  return { taxas: lerTaxas(data), gravavel: true }
}

/** Tudo o que as telas precisam, uma vez por request. */
export const carregarBase = cache(async (lojaId: number): Promise<BaseCusto | null> => {
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'omie' && modo !== 'proprio') return null
  const avisos: string[] = []
  const [{ taxas, gravavel }, produtos] = await Promise.all([carregarTaxas(lojaId), produtosDaLoja(lojaId)])
  if (!gravavel) avisos.push('Meta e taxas ainda não podem ser salvas nesta base (migration 473 pendente). Usando os valores padrão.')
  let fichas: Map<number, FichaArvore>
  let cmc: Map<number, number | null>
  let unidadeNaFicha = new Map<number, string>()
  let dataCusto: string | null = null
  if (modo === 'omie') {
    const [f, c] = await Promise.all([fichasOmie(lojaId), custoOmie(lojaId)])
    fichas = f.fichas; unidadeNaFicha = f.unidade; cmc = c.cmc; dataCusto = c.data
  } else {
    const supabase = await createClient()
    const [f, c] = await Promise.all([carregarFichasAtivas(supabase, lojaId), custoProprio(lojaId)])
    fichas = f; cmc = c
  }
  return { lojaId, modo, taxas, configGravavel: gravavel, fichas, cmc, produtos, unidadeNaFicha, dataCusto, avisos }
})

export type LinhaPrato = {
  codigo: number
  codigoTexto: string
  descricao: string
  familia: string | null
  /** prato (vende) ou preparacao (PI, tipo 03). */
  tipo: 'prato' | 'preparacao'
  custo: number
  semCusto: number
  /** Insumos com custo médio que não faz sentido para a unidade. */
  suspeitos: number
  preco: number | null
  cmv: number | null
  situacao: Situacao
  sugeridoSalao: number
  sugeridoDelivery: number
  sobraSalao: number | null
  ciclo: boolean
}

export const ehPreparacao = (p: ProdutoInfo | undefined) => p?.tipo === '03'

/** Unidade do insumo: a da ficha do Omie, senão a do cadastro. */
const unidadeDe = (b: BaseCusto, cod: number) => b.unidadeNaFicha.get(cod) ?? b.produtos.get(cod)?.unidade?.toUpperCase() ?? null

function contarSuspeitos(b: BaseCusto, nos: NoArvore[]): number {
  let n = 0
  for (const x of nos) {
    if (x.filhos.length) n += contarSuspeitos(b, x.filhos)
    else if (custoSuspeito(x.custoUnitarioCmc, unidadeDe(b, x.codigo))) n++
  }
  return n
}

export function linhasDoCardapio(b: BaseCusto): LinhaPrato[] {
  const out: LinhaPrato[] = []
  for (const cod of b.fichas.keys()) {
    const p = b.produtos.get(cod)
    if (p?.inativo) continue
    const a = arvoreCustoFicha(b.fichas, b.cmc, cod, 1)
    if (!a) continue
    const preco = precoReal(p?.preco) ? p!.preco : null
    const suspeitos = contarSuspeitos(b, a.filhos)
    out.push({
      codigo: cod, codigoTexto: p?.codigoTexto ?? String(cod), descricao: p?.descricao ?? `Produto ${cod}`, familia: p?.familia ?? null,
      tipo: ehPreparacao(p) ? 'preparacao' : 'prato', custo: a.total, semCusto: a.semCusto, suspeitos, preco,
      cmv: preco ? a.total / preco : null, situacao: situacao(a.total, preco, a.semCusto, b.taxas, suspeitos),
      sugeridoSalao: precoSugeridoSalao(a.total, b.taxas), sugeridoDelivery: precoSugeridoDelivery(a.total, b.taxas),
      sobraSalao: preco ? sobraPorVenda(preco, a.total, b.taxas, 'salao') : null, ciclo: a.ciclo,
    })
  }
  return out.sort((x, y) => x.descricao.localeCompare(y.descricao, 'pt-BR'))
}

/** Nó da árvore pronto para a tela (com nome e unidade). */
export type NoTela = Omit<NoArvore, 'filhos'> & { descricao: string; unidade: string | null; suspeito: boolean; filhos: NoTela[] }

export function arvoreDoPrato(b: BaseCusto, codigo: number): (Omit<ArvoreCusto, 'filhos'> & { filhos: NoTela[] }) | null {
  const a = arvoreCustoFicha(b.fichas, b.cmc, codigo, 1)
  if (!a) return null
  const vestir = (n: NoArvore): NoTela => {
    const p = b.produtos.get(n.codigo)
    const unidade = unidadeDe(b, n.codigo)
    return { ...n, descricao: p?.descricao ?? `Produto ${n.codigo}`, unidade, suspeito: !n.filhos.length && custoSuspeito(n.custoUnitarioCmc, unidade), filhos: n.filhos.map(vestir) }
  }
  return { ...a, filhos: a.filhos.map(vestir) }
}
