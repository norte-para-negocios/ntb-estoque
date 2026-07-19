// Leitura do fato de faturamento por cupom, gravado no Contabo (sem cópia
// no Supabase -- Faturamento nunca teve janela quente, ver spec
// docs/superpowers/specs/2026-07-18-faturamento-fato-cupom-design.md).
// Mesmo espirito de lib/relatorio-frio-nf.ts: um modulo por dominio de
// leitura fria, sempre via buscarFrio.
import { buscarFrio, buscarFrioTudo } from '@/lib/historico-contabo'

export type LinhaFatAgregado = { rotulo: string; mes?: string; valor: number; qtde_itens: number }

export async function buscarFatAgregado(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  group: 'dia' | 'forma' | 'produto'
  group2?: 'mes'
}): Promise<LinhaFatAgregado[]> {
  const rows = await buscarFrio<{ rotulo: string; mes?: string; valor: string | number; qtde_itens: string | number }>(
    '/fat_agregado',
    { loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal, group: opts.group, group2: opts.group2 },
  )
  return rows.map((r) => ({ rotulo: String(r.rotulo), mes: r.mes, valor: Number(r.valor) || 0, qtde_itens: Number(r.qtde_itens) || 0 }))
}

export type CupomFat = {
  n_id_cupom: number; chave: string | null; data: string; hora: string | null
  num: string | null; serie: string | null; valor: number; cancelado: boolean; devolvido: boolean
}

// Achado real (auditoria movimentacao-operacao-auto, 2026-07-19): /fat_cupons
// (limit 5000) e /fat_cupom_itens (limit 20000) no servidor cortavam em
// silencio pra qualquer loja com historico de 1 ano -- loja 5 sozinha tem
// 31038 cupons e 213669 itens desde 01/07/2025 (so ~16%/9% vinha antes do
// fix). Servidor ganhou suporte a `offset` (mesmo padrao de /notas_fiscais);
// client agora pagina igual aos outros dominios frios.
export async function buscarFatCupons(opts: { lojaId: number; dataInicio: string; dataFinal: string }): Promise<CupomFat[]> {
  const rows = await buscarFrioTudo<CupomFat & { valor: string | number }>('/fat_cupons', {
    loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal,
  }, 5000)
  return rows.map((r) => ({ ...r, valor: Number(r.valor) || 0 }))
}

export async function buscarFatCupomItens(opts: { lojaId: number; dataInicio: string; dataFinal: string }): Promise<ItemFat[]> {
  const rows = await buscarFrioTudo<ItemFat & { quant: string | number; v_unit: string | number; v_desc: string | number; v_item: string | number }>(
    '/fat_cupom_itens', { loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal }, 20000,
  )
  return rows.map((i) => ({ ...i, quant: Number(i.quant) || 0, v_unit: Number(i.v_unit) || 0, v_desc: Number(i.v_desc) || 0, v_item: Number(i.v_item) || 0 }))
}

export type ItemFat = {
  id_item: number; n_id_cupom: number; id_produto: number | null; cfop: string | null; ncm: string | null
  quant: number; v_unit: number; v_desc: number; v_item: number; x_prod: string | null
}
export type PagamentoFat = {
  n_id_cupom: number; sequencia: number; tipo_doc: string | null; valor: number
  categoria: string | null; id_conta_corrente: number | null
}

export async function buscarFatCupomDetalhe(
  lojaId: number,
  nIdCupom: number,
): Promise<{ cupom: CupomFat | null; itens: ItemFat[]; pagamentos: PagamentoFat[] }> {
  const [cupons, itens, pagamentos] = await Promise.all([
    buscarFrio<CupomFat & { valor: string | number }>('/fat_cupons', { loja_id: lojaId, n_id_cupom: nIdCupom }),
    buscarFrio<ItemFat & { quant: string | number; v_unit: string | number; v_desc: string | number; v_item: string | number }>(
      '/fat_cupom_itens', { loja_id: lojaId, n_id_cupom: nIdCupom },
    ),
    buscarFrio<PagamentoFat & { valor: string | number }>('/fat_cupom_pagamentos', { loja_id: lojaId, n_id_cupom: nIdCupom }),
  ])
  const cupom = cupons[0] ? { ...cupons[0], valor: Number(cupons[0].valor) || 0 } : null
  return {
    cupom,
    itens: itens.map((i) => ({ ...i, quant: Number(i.quant) || 0, v_unit: Number(i.v_unit) || 0, v_desc: Number(i.v_desc) || 0, v_item: Number(i.v_item) || 0 })),
    pagamentos: pagamentos.map((p) => ({ ...p, valor: Number(p.valor) || 0 })),
  }
}
