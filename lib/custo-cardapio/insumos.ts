import 'server-only'
import { limparTexto } from './formato'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { arvoreCustoFicha, type ArvoreCusto } from '@/lib/estoque/arvore-custo-puro'
import { serieCustoMedio, type PontoCusto } from '@/lib/estoque/custo-produto-puro'
import type { LinhaBruta } from '@/lib/compras/sugestao-puro'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { carregarBase, ehPreparacao, type BaseCusto } from './carregar'
import { custoSuspeito } from './preco-puro'
import { saltoEstranho, usosDasArvores, variacaoPorCompras, type Compra, type Uso, type VarCompra } from './insumos-puro'

// Norte Cozinha: dados de Insumos, Início e Estoque da cozinha. Só leitura.
// Insumo = folha das fichas (usado em alguma ficha, sem ficha própria). Custo agora = o de carregarBase.
// "Subiu no mês" = preço de compra (notas fiscais ou entradas de compra), não fotos de posicao_estoques:
// a posição só guarda as 2 fotos mais recentes.

type Pg<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export type InsumoLinha = {
  codigo: number
  codigoTexto: string
  descricao: string
  unidade: string | null
  familia: string | null
  inativo: boolean
  custo: number | null
  suspeito: boolean
  /** Pratos (não preparações) que usam o insumo, direto ou por uma preparação. */
  pratos: number
  preparacoes: number
}

export type DadosInsumos = {
  base: BaseCusto
  usos: Map<number, Uso[]>
  arvores: Map<number, ArvoreCusto>
  insumos: InsumoLinha[]
  unidade: (cod: number) => string | null
  ehPrato: (raiz: number) => boolean
}

/** Unidade do insumo: a da ficha do Omie, senão a do cadastro (mesma regra de carregar.ts). */
const unidadeDe = (b: BaseCusto, cod: number) => b.unidadeNaFicha.get(cod) ?? b.produtos.get(cod)?.unidade?.toUpperCase() ?? null

export const dadosInsumos = cache(async (lojaId: number): Promise<DadosInsumos | null> => {
  const base = await carregarBase(lojaId)
  if (!base) return null
  const arvores = new Map<number, ArvoreCusto>()
  for (const cod of base.fichas.keys()) {
    if (base.produtos.get(cod)?.inativo) continue
    const a = arvoreCustoFicha(base.fichas, base.cmc, cod, 1)
    if (a) arvores.set(cod, a)
  }
  const usos = usosDasArvores(arvores.values())
  const ehPrato = (raiz: number) => !ehPreparacao(base.produtos.get(raiz))
  const unidade = (cod: number) => unidadeDe(base, cod)
  const insumos: InsumoLinha[] = []
  for (const [cod, lista] of usos) {
    const p = base.produtos.get(cod)
    const c = base.cmc.get(cod)
    const custo = c != null && c > 0 ? c : null
    const pratos = lista.filter((u) => ehPrato(u.raiz)).length
    insumos.push({
      codigo: cod, codigoTexto: p?.codigoTexto ?? String(cod), descricao: p?.descricao ?? `Produto ${cod}`, unidade: unidade(cod),
      familia: p?.familia ?? null, inativo: !!p?.inativo, custo, suspeito: custoSuspeito(custo, unidade(cod)), pratos, preparacoes: lista.length - pratos,
    })
  }
  insumos.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
  return { base, usos, arvores, insumos, unidade, ehPrato }
})

const somarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

export type VariacaoCompras = {
  porProduto: Map<number, VarCompra>
  /** notas = notas fiscais de entrada; entradas = compras lançadas no estoque próprio (ledger). */
  fonte: 'notas' | 'entradas'
  /** Começo da janela de comparação (120 dias atrás) e o corte entre "antes" e "agora" (30 dias atrás). */
  desde: string
  corte: string
}

/**
 * Variação do preço de compra por produto (para todos os insumos de uma vez): média ponderada das compras dos
 * últimos 30 dias contra a dos 30–120 dias antes, por unidade do estoque.
 * Próprio: entradas de compra do ledger (estoque_movimentos_efetivo, origem COMPRA, já na unidade base; estornadas
 * fora); se não houver nenhuma, cai nas notas. Omie: notas_fiscais concluídas (etapa 60, não excluídas nem canceladas)
 * + itens (total ÷ quantidade recebida no estoque, como a Sugestão de compra), itens em lotes de ≤200 notas.
 */
export const variacaoDeCompras = cache(async (lojaId: number, modo: 'omie' | 'proprio'): Promise<VariacaoCompras> => {
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const desde = somarDias(hoje, -120)
  const corte = somarDias(hoje, -30)
  const pronto = (compras: Compra[], fonte: VariacaoCompras['fonte']) => ({ porProduto: variacaoPorCompras(compras, hoje, 30, 120), fonte, desde, corte })

  if (modo === 'proprio') {
    type M = { id: number; codigo_produto: number; data_ref: string; quantidade: number; custo_unitario: number | null; reverses_id: number | null }
    const movs = await buscarTodasLinhas<M>((from, to) =>
      supabase.from('estoque_movimentos_efetivo').select('id, codigo_produto, data_ref, quantidade, custo_unitario, reverses_id')
        .eq('loja_id', lojaId).eq('origem', 'COMPRA').gte('data_ref', desde).order('id').range(from, to) as unknown as Pg<M>)
    const estornados = new Set(movs.map((m) => m.reverses_id).filter((x): x is number => x != null).map(Number))
    const compras = movs
      .filter((m) => m.reverses_id == null && !estornados.has(Number(m.id)) && Number(m.quantidade) > 0 && Number(m.custo_unitario) > 0)
      .map((m) => ({ produto: Number(m.codigo_produto), data: String(m.data_ref).slice(0, 10), quantidade: Number(m.quantidade), valor: Number(m.quantidade) * Number(m.custo_unitario) }))
    if (compras.length) return pronto(compras, 'entradas')
  }

  type N = { id: number; d_emissao_nfe: string | null; cancelada: string | null }
  const notas = (await buscarTodasLinhas<N>((from, to) =>
    supabase.from('notas_fiscais').select('id, d_emissao_nfe, cancelada:full_object->infoCadastro->>cCancelada')
      .eq('loja_id', lojaId).is('deleted_at', null).eq('c_etapa', '60').gte('d_emissao_nfe', desde).order('id').range(from, to) as unknown as Pg<N>))
    .filter((n) => n.cancelada !== 'S' && n.d_emissao_nfe)
  const diaDa = new Map(notas.map((n) => [Number(n.id), String(n.d_emissao_nfe).slice(0, 10)]))
  const ids = [...diaDa.keys()]
  type I = { id: number; nota_fiscal_id: number; n_id_produto: number | null; n_qtde_nfe: number | null; n_preco_unit: number | null; v_total_item: number | null; qrec: string | null; naomov: string | null; c_ignorar_item: string | null }
  const lotes: number[][] = []
  for (let k = 0; k < ids.length; k += 200) lotes.push(ids.slice(k, k + 200))
  const itens = (await Promise.all(lotes.map((lote) => buscarTodasLinhas<I>((from, to) =>
    supabase.from('nota_fiscal_items')
      .select('id, nota_fiscal_id, n_id_produto, n_qtde_nfe, n_preco_unit, v_total_item, c_ignorar_item, qrec:full_object->itensAjustes->>nQtdeRecebida, naomov:full_object->itensAjustes->>cNaoGerarMovEstoque')
      .eq('loja_id', lojaId).in('nota_fiscal_id', lote).order('id').range(from, to) as unknown as Pg<I>)))).flat()
  const compras: Compra[] = []
  for (const i of itens) {
    if (i.n_id_produto == null || i.naomov === 'S' || i.c_ignorar_item === 'S') continue
    const rec = Number(i.qrec)
    const q = rec > 0 ? rec : Number(i.n_qtde_nfe) || 0
    const valor = Number(i.v_total_item) > 0 ? Number(i.v_total_item) : (Number(i.n_qtde_nfe) || 0) * (Number(i.n_preco_unit) || 0)
    const data = diaDa.get(Number(i.nota_fiscal_id))
    if (data && q > 0 && valor > 0) compras.push({ produto: Number(i.n_id_produto), data, quantidade: q, valor })
  }
  return pronto(compras, 'notas')
})

/** Variação do preço de compra de cada insumo das fichas (salto de 5× ou mais fica de fora: unidade trocada). */
export function variacoes(d: DadosInsumos, vc: VariacaoCompras): Map<number, number> {
  const out = new Map<number, number>()
  for (const i of d.insumos) {
    const v = vc.porProduto.get(i.codigo)?.variacao ?? null
    if (v != null && !saltoEstranho(v)) out.set(i.codigo, v)
  }
  return out
}

/** Rótulo da fonte para a tela. */
export const rotuloFonte = (vc: VariacaoCompras) => (vc.fonte === 'notas' ? 'pelas notas de compra' : 'pelas compras lançadas no estoque')

export type CompraRecente = { fornecedor: string | null; ultimoCusto: number | null; ultimaCompra: string | null; consumoPorDia: number | null }

/**
 * Último fornecedor, último custo (por unidade do estoque) e consumo dos últimos 30 dias, pela mesma função do banco
 * da Sugestão de compra (sugestao_compra_omie / _proprio, migrations 201/241). Uma chamada; falhou = mapa vazio.
 */
export const comprasRecentes = cache(async (lojaId: number, modo: 'omie' | 'proprio'): Promise<{ porProduto: Map<number, CompraRecente>; erro: boolean }> => {
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const ini = somarDias(hoje, -30)
  const { data, error } = await supabase.rpc(modo === 'omie' ? 'sugestao_compra_omie' : 'sugestao_compra_proprio',
    { p_loja: lojaId, p_ini: ini, p_fim: hoje, p_proj_ini: hoje, p_proj_fim: somarDias(hoje, 7) })
  const porProduto = new Map<number, CompraRecente>()
  if (error) {
    console.error('cozinha: sugestao_compra falhou', error.message)
    return { porProduto, erro: true }
  }
  for (const b of (Array.isArray(data) ? data : []) as LinhaBruta[]) {
    const consumo = Number(b.consumo_total)
    porProduto.set(Number(b.codigo_produto), {
      fornecedor: b.fornecedor_nome ? limparTexto(b.fornecedor_nome).trim() || null : null,
      ultimoCusto: b.ultimo_custo != null && Number(b.ultimo_custo) > 0 ? Number(b.ultimo_custo) : null,
      ultimaCompra: b.ultima_compra ? String(b.ultima_compra).slice(0, 10) : null,
      consumoPorDia: Number.isFinite(consumo) && consumo > 0 ? consumo / 31 : null,
    })
  }
  return { porProduto, erro: false }
})

/**
 * Custo médio do produto no tempo (últimos ~180 dias). Omie: uma foto por dia da linha do local 0 (índice único
 * loja+local+produto+data); com menos de 2 pontos, o kardex do Omie. Próprio: ledger (estoque_movimentos_efetivo).
 */
export async function historicoCusto(lojaId: number, modo: 'omie' | 'proprio', codigo: number): Promise<PontoCusto[]> {
  const supabase = await createClient()
  const desde = somarDias(hojeBahiaISO(), -180)
  if (modo === 'omie') {
    const { data } = await supabase.from('posicao_estoques').select('data_posicao, n_cmc').eq('loja_id', lojaId).eq('codigo_local_estoque', 0)
      .eq('n_cod_prod', codigo).gte('data_posicao', desde).gt('n_cmc', 0).order('data_posicao').limit(400)
    const fotos = (data ?? []).map((r) => ({ data: String(r.data_posicao).slice(0, 10), cmc: Number(r.n_cmc) }))
    if (fotos.length >= 2) return fotos
    const { data: k } = await supabase.from('kardex_omie').select('id_mov, data_mov, codigo_local_estoque, quantidade, valor_unit, cmc_apos, saldo_apos, cancelado')
      .eq('loja_id', lojaId).eq('n_cod_prod', codigo).gte('data_mov', desde).order('data_mov', { ascending: false }).order('id_mov', { ascending: false }).limit(1000)
    const series = serieCustoMedio((k ?? []).map((m) => ({
      data: String(m.data_mov).slice(0, 10), ordem: Number(m.id_mov), local: Number(m.codigo_local_estoque), quantidade: Number(m.quantidade),
      valorUnit: m.valor_unit == null ? null : Number(m.valor_unit), cmc: m.cmc_apos == null ? null : Number(m.cmc_apos),
      saldo: m.saldo_apos == null ? null : Number(m.saldo_apos), cancelado: !!m.cancelado,
    })))
    const maior = [...series.values()].sort((a, b) => b.length - a.length)[0]
    return maior && maior.length > fotos.length ? maior : fotos
  }
  const { data } = await supabase.from('estoque_movimentos_efetivo').select('id, data_ref, codigo_local_estoque, quantidade, custo_unitario, cmc_apos, saldo_apos, reverses_id')
    .eq('loja_id', lojaId).eq('codigo_produto', codigo).gte('data_ref', desde).order('data_ref', { ascending: false }).order('id', { ascending: false }).limit(1000)
  type R = { id: number; data_ref: string; codigo_local_estoque: number; quantidade: number; custo_unitario: number | null; cmc_apos: number | null; saldo_apos: number; reverses_id: number | null }
  const rows = (data ?? []) as R[]
  const estornados = new Set(rows.map((r) => r.reverses_id).filter((x): x is number => x != null).map(Number))
  // O custo médio do próprio é um só por produto: junta os locais numa linha só.
  const series = serieCustoMedio(rows.map((r) => ({
    data: String(r.data_ref).slice(0, 10), ordem: Number(r.id), local: 0, quantidade: Number(r.quantidade),
    valorUnit: r.custo_unitario == null ? null : Number(r.custo_unitario), cmc: r.cmc_apos == null ? null : Number(r.cmc_apos),
    saldo: Number(r.saldo_apos), cancelado: estornados.has(Number(r.id)) || r.reverses_id != null,
  })))
  return series.get(0) ?? []
}

export type CompraNota = {
  notaId: number; numero: string | null; emissao: string | null; fornecedor: string | null
  quantidade: number; unidadeNota: string | null; precoNota: number | null; total: number | null
  /** Custo por unidade do estoque (total ÷ quantidade recebida no estoque), quando a nota diz quanto entrou. */
  custoEstoque: number | null
}

/** Últimas notas de entrada com o produto (notas_fiscais + nota_fiscal_items, os dois modos gravam ali). */
export async function ultimasNotas(lojaId: number, codigo: number, limite = 10): Promise<CompraNota[]> {
  const supabase = await createClient()
  // Sem filtro no lado da nota embutida (plano instável, ver NotasDoProduto): filtra e ordena aqui.
  const { data } = await supabase.from('nota_fiscal_items')
    .select('id, nota_fiscal_id, n_qtde_nfe, c_unidade_nfe, n_preco_unit, v_total_item, qrec:full_object->itensAjustes->>nQtdeRecebida, notas_fiscais!inner(id, c_numero_nfe, d_emissao_nfe, c_razao_social, c_nome, deleted_at)')
    .eq('loja_id', lojaId).eq('n_id_produto', codigo).order('id', { ascending: false }).limit(60)
  type Nf = { id: number; c_numero_nfe: string | null; d_emissao_nfe: string | null; c_razao_social: string | null; c_nome: string | null; deleted_at: string | null }
  type R = { nota_fiscal_id: number; n_qtde_nfe: number | null; c_unidade_nfe: string | null; n_preco_unit: number | null; v_total_item: number | null; qrec: string | null; notas_fiscais: Nf | Nf[] | null }
  return ((data ?? []) as unknown as R[])
    .map((i) => ({ i, nf: Array.isArray(i.notas_fiscais) ? i.notas_fiscais[0] : i.notas_fiscais }))
    .filter((x): x is { i: R; nf: Nf } => !!x.nf && !x.nf.deleted_at)
    .sort((a, b) => String(b.nf.d_emissao_nfe ?? '').localeCompare(String(a.nf.d_emissao_nfe ?? '')))
    .slice(0, limite)
    .map(({ i, nf }) => {
      const q = Number(i.n_qtde_nfe) || 0
      const preco = Number(i.n_preco_unit) > 0 ? Number(i.n_preco_unit) : null
      const total = Number(i.v_total_item) > 0 ? Number(i.v_total_item) : preco != null ? q * preco : null
      const rec = Number(i.qrec)
      return {
        notaId: Number(i.nota_fiscal_id), numero: nf.c_numero_nfe, emissao: nf.d_emissao_nfe ? String(nf.d_emissao_nfe).slice(0, 10) : null,
        fornecedor: limparTexto(nf.c_razao_social || nf.c_nome || '').trim() || null, quantidade: q, unidadeNota: i.c_unidade_nfe?.trim() || null,
        precoNota: preco, total, custoEstoque: total != null && rec > 0 ? total / rec : null,
      }
    })
}
