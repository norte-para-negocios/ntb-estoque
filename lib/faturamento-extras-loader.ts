import { createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { buscarFatCupons, buscarFatCupomPagamentosPeriodo, FORMA_PGTO_LABEL } from '@/lib/faturamento-frio'
import { calcularDescontoPorProduto, calcularDescontoPorFormaPgto, type DescontoRanking } from '@/lib/faturamento-descontos'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { bateSituacaoOmie, bateSituacaoProprio } from '@/lib/faturamento-itens-loader'
import type { Pagamento } from '@/lib/faturamento-itens'
import type { Situacao } from '@/lib/faturamento-params'

export type CupomLinha = { id: number; dia: string; hora: string | null; num: string | null; valor: number; situacao: 'Autorizada' | 'Devolvida' | 'Cancelada' }

const situacaoDe = (c: { cancelado: boolean; devolvido: boolean }): CupomLinha['situacao'] => (c.cancelado ? 'Cancelada' : c.devolvido ? 'Devolvida' : 'Autorizada')

type VendaProp = { id: number; data: string; hora: string | null; pedido_ref: string | null; nota_numero: string | null; valor: number | string; cancelado: boolean; devolvido: boolean }

async function vendasProprio(lojaId: number, ini: string, fim: string, situacao: Situacao, onErro: (m: string) => void): Promise<VendaProp[]> {
  const supabase = createServiceClient()
  const todas = await buscarTodasLinhas<VendaProp>(
    (from, to) => supabase.from('vendas_proprio').select('id, data, hora, pedido_ref, nota_numero, valor, cancelado, devolvido').eq('loja_id', lojaId).gte('data', ini).lte('data', fim).order('id').range(from, to),
    undefined,
    (e) => onErro(`Falha ao ler as vendas (${e.message}). Os valores podem estar incompletos.`),
  )
  return todas.filter((v) => bateSituacaoProprio(v, situacao))
}

// Pagamentos do periodo (forma de pgto) dos cupons que casam com a situacao.
export async function carregarPagamentos(lojaId: number, ini: string, fim: string, situacao: Situacao): Promise<{ linhas: Pagamento[]; aviso: string | null }> {
  let aviso: string | null = null
  const linhas: Pagamento[] = []
  if ((await modoDaLoja(lojaId)) === 'proprio') {
    const vendas = await vendasProprio(lojaId, ini, fim, situacao, (m) => { aviso = m })
    const ids = vendas.map((v) => v.id)
    const supabase = createServiceClient()
    for (let i = 0; i < ids.length; i += 150) {
      const lote = ids.slice(i, i + 150)
      const pags = await buscarTodasLinhas<{ venda_id: number; metodo: string | null; tipo_doc: string | null; valor: number | string }>(
        (from, to) => supabase.from('vendas_proprio_pagamentos').select('venda_id, metodo, tipo_doc, valor').in('venda_id', lote).order('id').range(from, to),
        undefined,
        (e) => { aviso = `Falha ao ler os pagamentos (${e.message}). Os valores podem estar incompletos.` },
      )
      for (const p of pags) linhas.push({ cupom: p.venda_id, forma: p.metodo || p.tipo_doc || 'Não identificado', valor: Number(p.valor) || 0 })
    }
    return { linhas, aviso }
  }
  let truncou = false
  const onTruncado = () => { truncou = true }
  const [cupons, pags] = await Promise.all([
    buscarFatCupons({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado }),
    buscarFatCupomPagamentosPeriodo({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado }),
  ])
  if (truncou) aviso = 'A consulta ao histórico foi cortada antes do fim. Os valores abaixo podem estar incompletos.'
  const validos = new Set(cupons.filter((c) => bateSituacaoOmie(c, situacao)).map((c) => c.n_id_cupom))
  for (const p of pags) {
    if (!validos.has(p.n_id_cupom) || !(Number(p.valor) || 0)) continue
    linhas.push({ cupom: p.n_id_cupom, forma: FORMA_PGTO_LABEL[p.tipo_doc ?? ''] ?? (p.tipo_doc || 'Não identificado'), valor: Number(p.valor) || 0 })
  }
  return { linhas, aviso }
}

// Lista de cupons do periodo (mais recentes primeiro).
export async function carregarCupons(lojaId: number, ini: string, fim: string, situacao: Situacao): Promise<{ linhas: CupomLinha[]; aviso: string | null }> {
  let aviso: string | null = null
  let linhas: CupomLinha[]
  if ((await modoDaLoja(lojaId)) === 'proprio') {
    const vendas = await vendasProprio(lojaId, ini, fim, situacao, (m) => { aviso = m })
    linhas = vendas.map((v) => ({ id: v.id, dia: String(v.data).slice(0, 10), hora: v.hora, num: v.nota_numero || v.pedido_ref, valor: Number(v.valor) || 0, situacao: situacaoDe(v) }))
  } else {
    let truncou = false
    const cupons = await buscarFatCupons({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado: () => { truncou = true } })
    if (truncou) aviso = 'A consulta ao histórico foi cortada antes do fim. A lista pode estar incompleta.'
    linhas = cupons.filter((c) => bateSituacaoOmie(c, situacao)).map((c) => ({ id: c.n_id_cupom, dia: String(c.data).slice(0, 10), hora: c.hora, num: c.num, valor: c.valor, situacao: situacaoDe(c) }))
  }
  linhas.sort((a, b) => (a.dia === b.dia ? (b.hora ?? '').localeCompare(a.hora ?? '') : b.dia.localeCompare(a.dia)))
  return { linhas, aviso }
}

// Descontos por produto e por forma de pagamento (so lojas Omie por enquanto).
export async function carregarDescontos(lojaId: number, ini: string, fim: string): Promise<{ suportado: boolean; porProduto: DescontoRanking[]; porForma: DescontoRanking[] }> {
  if ((await modoDaLoja(lojaId)) === 'proprio') return { suportado: false, porProduto: [], porForma: [] }
  const [porProduto, porForma] = await Promise.all([
    calcularDescontoPorProduto({ lojaId, dataInicio: ini, dataFinal: fim, topN: 20 }),
    calcularDescontoPorFormaPgto({ lojaId, dataInicio: ini, dataFinal: fim }),
  ])
  return { suportado: true, porProduto, porForma }
}
