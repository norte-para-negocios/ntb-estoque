import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

// Saldo atual e mínimo por produto (soma dos locais), nos dois modos de estoque. Só leitura.
// Omie: foto mais recente de posicao_estoques que já tem linha de local real (o local 0 é a sentinela: mínimo + CMC, nunca saldo).
// Próprio: estoque_saldos (ledger do app).

export type SaldoProduto = { saldo: number; minimo: number }
export type Saldos = { porProduto: Map<number, SaldoProduto>; data: string | null }

type Pg<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export const saldosDaLoja = cache(async (lojaId: number, modo: 'omie' | 'proprio'): Promise<Saldos> => {
  const supabase = await createClient()
  const porProduto = new Map<number, SaldoProduto>()
  const pegar = (cod: number) => { const s = porProduto.get(cod) ?? { saldo: 0, minimo: 0 }; porProduto.set(cod, s); return s }
  if (modo === 'proprio') {
    type R = { codigo_produto: number; codigo_local_estoque: number; saldo: number | null; minimo: number | null }
    const rows = await buscarTodasLinhas<R>((from, to) =>
      supabase.from('estoque_saldos').select('codigo_produto, codigo_local_estoque, saldo, minimo').eq('loja_id', lojaId)
        .order('codigo_produto').order('codigo_local_estoque').range(from, to) as unknown as Pg<R>)
    for (const r of rows) { const s = pegar(Number(r.codigo_produto)); s.saldo += Number(r.saldo ?? 0); s.minimo += Number(r.minimo ?? 0) }
    return { porProduto, data: null }
  }
  const { data: foto } = await supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).neq('codigo_local_estoque', 0)
    .order('data_posicao', { ascending: false }).limit(1).maybeSingle()
  if (!foto?.data_posicao) return { porProduto, data: null }
  type R = { n_cod_prod: number; codigo_local_estoque: number | null; n_saldo: number | null; estoque_minimo: number | null }
  const rows = await buscarTodasLinhas<R>((from, to) =>
    supabase.from('posicao_estoques').select('id, n_cod_prod, codigo_local_estoque, n_saldo, estoque_minimo').eq('loja_id', lojaId)
      .eq('data_posicao', foto.data_posicao).order('id').range(from, to) as unknown as Pg<R>)
  for (const r of rows) {
    const s = pegar(Number(r.n_cod_prod))
    if (Number(r.codigo_local_estoque ?? 0) === 0) s.minimo = Math.max(s.minimo, Number(r.estoque_minimo ?? 0))
    else s.saldo += Number(r.n_saldo ?? 0)
  }
  return { porProduto, data: String(foto.data_posicao).slice(0, 10) }
})
