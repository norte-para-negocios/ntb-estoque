import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { arvoreCustoFicha, type ArvoreCusto } from '@/lib/estoque/arvore-custo-puro'
import { serieCustoMedio, type PontoCusto } from '@/lib/estoque/custo-produto-puro'
import type { LinhaBruta } from '@/lib/compras/sugestao-puro'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { carregarBase, ehPreparacao, type BaseCusto } from './carregar'
import { cmcDaFoto, custoSuspeito } from './preco-puro'
import { saltoEstranho, usosDasArvores, variacao, type Uso } from './insumos-puro'

// Norte Cozinha: dados de Insumos, Início e Estoque da cozinha. Só leitura.
// Insumo = folha das fichas (usado em alguma ficha, sem ficha própria). Custo agora = o de carregarBase;
// custo de ~30 dias atrás = foto de posicao_estoques (Omie: linha do local 0, que traz o CMC; próprio: todos os locais).

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
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

export type CustoAntes = { data: string; dias: number; cmc: Map<number, number> }

/**
 * Custo médio por produto na foto de ~`dias` atrás (a última foto até lá; sem nenhuma, a mais antiga, se tiver
 * pelo menos 14 dias). null quando não há foto antiga o bastante.
 */
export const custoDeAntes = cache(async (lojaId: number, modo: 'omie' | 'proprio', referencia: string | null, dias = 30): Promise<CustoAntes | null> => {
  const supabase = await createClient()
  const ref = referencia ?? hojeBahiaISO()
  const alvo = somarDias(ref, -dias)
  const soLocal0 = modo === 'omie'
  const qDatas = () => {
    const q = supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId)
    return soLocal0 ? q.eq('codigo_local_estoque', 0) : q
  }
  let { data: foto } = await qDatas().lte('data_posicao', alvo).order('data_posicao', { ascending: false }).limit(1).maybeSingle()
  if (!foto?.data_posicao) ({ data: foto } = await qDatas().order('data_posicao', { ascending: true }).limit(1).maybeSingle())
  const data = foto?.data_posicao ? String(foto.data_posicao).slice(0, 10) : null
  if (!data || diasEntre(data, ref) < 14) return null
  type R = { n_cod_prod: number; codigo_local_estoque: number | null; n_cmc: number; n_saldo: number }
  const rows = await buscarTodasLinhas<R>((from, to) => {
    let q = supabase.from('posicao_estoques').select('id, n_cod_prod, codigo_local_estoque, n_cmc, n_saldo').eq('loja_id', lojaId)
    if (soLocal0) q = q.eq('codigo_local_estoque', 0)
    return q.eq('data_posicao', data).gt('n_cmc', 0).order('id').range(from, to) as unknown as Pg<R>
  })
  const cmc = cmcDaFoto(rows.map((r) => ({ produto: Number(r.n_cod_prod), local: Number(r.codigo_local_estoque ?? 0), cmc: Number(r.n_cmc), saldo: Number(r.n_saldo) })))
  return { data, dias: diasEntre(data, ref), cmc }
})

/** Variação do custo de cada insumo (só quando os dois custos são confiáveis). */
export function variacoes(d: DadosInsumos, antes: CustoAntes | null): Map<number, number> {
  const out = new Map<number, number>()
  if (!antes) return out
  for (const i of d.insumos) {
    if (i.suspeito) continue
    const b = antes.cmc.get(i.codigo) ?? null
    if (b == null || custoSuspeito(b, i.unidade)) continue
    const v = variacao(i.custo, b)
    if (v != null && !saltoEstranho(v)) out.set(i.codigo, v)
  }
  return out
}

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
      fornecedor: b.fornecedor_nome?.trim() || null,
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
        fornecedor: (nf.c_razao_social || nf.c_nome || '').trim() || null, quantidade: q, unidadeNota: i.c_unidade_nfe?.trim() || null,
        precoNota: preco, total, custoEstoque: total != null && rec > 0 ? total / rec : null,
      }
    })
}
