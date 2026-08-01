// lib/faturamento-descontos.ts
// Desconto por produto e por forma de pagamento -- achado real 2026-08-01
// (auditoria cruzando FAT_SVVM_2026.xlsx): v_desc ja existe em
// fat_cupom_itens, mas nunca era somado/rankeado como metrica propria.
import { createServiceClient } from '@/lib/supabase/server'
import { buscarFatCupomItens, buscarFatCupomPagamentosPeriodo, type ItemFat, type PagamentoFat } from '@/lib/faturamento-frio'
import { buscarNomePorCodigo } from '@/lib/dashboard-gerencial'

export type DescontoRanking = { rotulo: string; valorDesconto: number }

export async function calcularDescontoPorProduto(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  topN: number
}): Promise<DescontoRanking[]> {
  const supabase = createServiceClient()
  const [itens, nomePorCodigo] = await Promise.all([
    buscarFatCupomItens(opts),
    buscarNomePorCodigo(supabase, opts.lojaId),
  ])
  const porProduto = new Map<string, number>()
  for (const it of itens) {
    if (!it.v_desc || it.id_produto == null) continue
    const nome = nomePorCodigo.get(Number(it.id_produto)) ?? it.x_prod ?? `Produto ${it.id_produto}`
    porProduto.set(nome, (porProduto.get(nome) ?? 0) + it.v_desc)
  }
  return [...porProduto.entries()]
    .map(([rotulo, valorDesconto]) => ({ rotulo, valorDesconto }))
    .sort((a, b) => b.valorDesconto - a.valorDesconto)
    .slice(0, opts.topN)
}

export async function calcularDescontoPorFormaPgto(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<DescontoRanking[]> {
  const [itens, pagamentos] = await Promise.all([
    buscarFatCupomItens(opts),
    buscarFatCupomPagamentosPeriodo(opts),
  ])
  // Desconto total por cupom.
  const descontoPorCupom = new Map<number, number>()
  for (const it of itens) {
    if (!it.v_desc) continue
    descontoPorCupom.set(it.n_id_cupom, (descontoPorCupom.get(it.n_id_cupom) ?? 0) + it.v_desc)
  }
  // Pagamentos agrupados por cupom (um cupom pode ter split entre formas).
  const pagamentosPorCupom = new Map<number, PagamentoFat[]>()
  for (const p of pagamentos) {
    const lista = pagamentosPorCupom.get(p.n_id_cupom) ?? []
    lista.push(p)
    pagamentosPorCupom.set(p.n_id_cupom, lista)
  }
  const porForma = new Map<string, number>()
  for (const [nIdCupom, descontoTotal] of descontoPorCupom) {
    const pagsDoCupom = pagamentosPorCupom.get(nIdCupom) ?? []
    if (!pagsDoCupom.length) continue
    const totalPago = pagsDoCupom.reduce((s, p) => s + p.valor, 0)
    if (totalPago <= 0) continue
    // Rateia proporcional ao valor de cada forma (cupom com split
    // cartao+pix, por exemplo -- nao atribui tudo pra primeira linha).
    for (const p of pagsDoCupom) {
      const forma = p.tipo_doc || 'Não informado'
      const fatia = descontoTotal * (p.valor / totalPago)
      porForma.set(forma, (porForma.get(forma) ?? 0) + fatia)
    }
  }
  return [...porForma.entries()]
    .map(([rotulo, valorDesconto]) => ({ rotulo, valorDesconto }))
    .sort((a, b) => b.valorDesconto - a.valorDesconto)
}
