import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

import type { Movimento, Situacao } from './tipos'
export type { Movimento, Situacao }
export { ROTULO_TIPO, TIPOS_ITEM } from './tipos'

export type SaldoLocal = { codigoLocal: number; local: string; saldo: number; minimo: number | null }

export type LinhaEstoque = {
  codigoProduto: number
  codigo: string
  descricao: string
  unidade: string
  tipoItem: string | null
  codigoFamilia: number | null
  familia: string
  saldo: number
  cmc: number
  valor: number
  minimo: number | null
  situacao: Situacao
  locais: SaldoLocal[]
}

export type LocalInfo = { codigoLocal: number; descricao: string; inativo: boolean }

export type VisaoEstoque = {
  linhas: LinhaEstoque[]
  locais: LocalInfo[]
  familias: { codigo: number; nome: string }[]
}

type ProdutoRow = {
  codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null
  tipo_item: string | null; codigo_familia: number | null; estoque_minimo: number | null
}

export function situacaoDe(saldo: number, minimo: number | null): Situacao {
  if (saldo < 0) return 'negativo'
  if (saldo === 0) return 'zerado'
  if (minimo != null && minimo > 0 && saldo < minimo) return 'baixo'
  return 'ok'
}

/** Carrega o estoque próprio da loja (RLS por loja já protege a leitura). */
export async function carregarEstoque(lojaId: number): Promise<VisaoEstoque> {
  const supabase = await createClient()

  const [produtos, saldos, custos, locaisRes, famRes] = await Promise.all([
    buscarTodasLinhas<ProdutoRow>((from, to) =>
      supabase.from('produtos')
        .select('codigo_produto, codigo, descricao, unidade, tipo_item, codigo_familia, estoque_minimo')
        .eq('loja_id', lojaId).neq('inativo', true).order('id').range(from, to)),
    buscarTodasLinhas<{ codigo_local_estoque: number; codigo_produto: number; saldo: number; minimo: number | null }>((from, to) =>
      supabase.from('estoque_saldos').select('codigo_local_estoque, codigo_produto, saldo, minimo')
        .eq('loja_id', lojaId).order('codigo_produto').order('codigo_local_estoque').range(from, to)),
    buscarTodasLinhas<{ codigo_produto: number; cmc: number }>((from, to) =>
      supabase.from('estoque_custos').select('codigo_produto, cmc').eq('loja_id', lojaId).order('codigo_produto').range(from, to)),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao, inativo').eq('loja_id', lojaId).order('descricao'),
    supabase.from('familias').select('codigo_familia, nome').eq('loja_id', lojaId).order('nome'),
  ])

  const locais: LocalInfo[] = (locaisRes.data ?? []).map((l) => ({
    codigoLocal: Number(l.codigo_local_estoque), descricao: l.descricao ?? String(l.codigo_local_estoque), inativo: l.inativo === 'S',
  }))
  const nomeLocal = new Map(locais.map((l) => [l.codigoLocal, l.descricao]))
  const familias = (famRes.data ?? []).map((f) => ({ codigo: Number(f.codigo_familia), nome: f.nome ?? String(f.codigo_familia) }))
  const nomeFamilia = new Map(familias.map((f) => [f.codigo, f.nome]))
  const cmcDe = new Map(custos.map((c) => [Number(c.codigo_produto), Number(c.cmc)]))

  const saldosPorProduto = new Map<number, SaldoLocal[]>()
  for (const s of saldos) {
    const k = Number(s.codigo_produto)
    const arr = saldosPorProduto.get(k) ?? []
    arr.push({
      codigoLocal: Number(s.codigo_local_estoque), local: nomeLocal.get(Number(s.codigo_local_estoque)) ?? String(s.codigo_local_estoque),
      saldo: Number(s.saldo), minimo: s.minimo == null ? null : Number(s.minimo),
    })
    saldosPorProduto.set(k, arr)
  }

  const linhas: LinhaEstoque[] = produtos.map((p) => {
    const cod = Number(p.codigo_produto)
    const locs = saldosPorProduto.get(cod) ?? []
    const saldo = locs.reduce((a, l) => a + l.saldo, 0)
    const minLocais = locs.filter((l) => l.minimo != null).reduce((a, l) => a + (l.minimo ?? 0), 0)
    const minimo = locs.some((l) => l.minimo != null) ? minLocais : p.estoque_minimo != null ? Number(p.estoque_minimo) : null
    const cmc = cmcDe.get(cod) ?? 0
    return {
      codigoProduto: cod, codigo: p.codigo ?? String(cod), descricao: p.descricao ?? '(sem descrição)', unidade: p.unidade ?? 'UN',
      tipoItem: p.tipo_item, codigoFamilia: p.codigo_familia == null ? null : Number(p.codigo_familia),
      familia: p.codigo_familia == null ? 'Sem família' : (nomeFamilia.get(Number(p.codigo_familia)) ?? 'Sem família'),
      saldo, cmc, valor: saldo * cmc, minimo, situacao: situacaoDe(saldo, minimo), locais: locs,
    }
  })
  return { linhas, locais, familias }
}

type MovRow = {
  id: number; tipo: string; origem: string; ref: string; quantidade: number; custo_unitario: number | null
  saldo_apos: number; cmc_apos: number | null; codigo_local_estoque: number; user_id: string | null; obs: string | null
  created_at: string; custo_estimado: boolean; reverses_id: number | null; codigo_produto: number
}

/** Kardex: últimos movimentos (por produto, por local, ou geral). */
export async function carregarMovimentos(
  lojaId: number,
  filtro: { codigoProduto?: number; codigoLocal?: number },
  limite = 100,
): Promise<Movimento[]> {
  const supabase = await createClient()
  let q = supabase.from('estoque_movimentos')
    .select('id, tipo, origem, ref, quantidade, custo_unitario, saldo_apos, cmc_apos, codigo_local_estoque, user_id, obs, created_at, custo_estimado, reverses_id, codigo_produto')
    .eq('loja_id', lojaId).order('id', { ascending: false }).limit(limite)
  if (filtro.codigoProduto != null) q = q.eq('codigo_produto', filtro.codigoProduto)
  if (filtro.codigoLocal != null) q = q.eq('codigo_local_estoque', filtro.codigoLocal)
  const { data } = await q
  const rows = (data ?? []) as MovRow[]
  if (!rows.length) return []

  const ids = rows.map((r) => r.id)
  const [{ data: estornos }, { data: locais }, { data: prods }] = await Promise.all([
    supabase.from('estoque_movimentos').select('reverses_id').eq('loja_id', lojaId).in('reverses_id', ids),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId),
    filtro.codigoProduto == null
      ? supabase.from('produtos').select('codigo_produto, codigo, descricao').eq('loja_id', lojaId)
          .in('codigo_produto', [...new Set(rows.map((r) => r.codigo_produto))])
      : Promise.resolve({ data: [] as { codigo_produto: number; codigo: string; descricao: string }[] }),
  ])
  const estornados = new Set((estornos ?? []).map((e) => Number(e.reverses_id)))
  const nomeLocal = new Map((locais ?? []).map((l) => [Number(l.codigo_local_estoque), l.descricao as string]))
  const nomeProd = new Map((prods ?? []).map((p) => [Number(p.codigo_produto), `${p.descricao} (${p.codigo})`]))

  return rows.map((r) => ({
    id: Number(r.id), tipo: r.tipo, origem: r.origem, ref: r.ref, quantidade: Number(r.quantidade),
    custo: r.custo_unitario == null ? null : Number(r.custo_unitario), saldoApos: Number(r.saldo_apos),
    cmcApos: r.cmc_apos == null ? null : Number(r.cmc_apos), local: nomeLocal.get(Number(r.codigo_local_estoque)) ?? String(r.codigo_local_estoque),
    codigoLocal: Number(r.codigo_local_estoque), user: r.user_id, obs: r.obs, criado: r.created_at,
    estornado: estornados.has(Number(r.id)), ehEstorno: r.reverses_id != null, custoEstimado: r.custo_estimado,
    codigoProduto: Number(r.codigo_produto), produto: nomeProd.get(Number(r.codigo_produto)),
  }))
}

