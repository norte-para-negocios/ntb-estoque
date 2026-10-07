// Montagem pura do fato de faturamento (cupom + itens + pagamentos) no formato que a ntb-frio-api e os relatórios já usam
// (mesmos campos de CupomBulkRow/ItemBulkRow/PagamentoBulkRow de lib/omie/faturamento.ts). Sem acesso a banco: testável.

export const BASE_ID_ITEM_PROPRIO = 8_000_000_000_000

export type VendaDb = {
  id: number; n_id_cupom: number; data: string; hora: string | null; valor: number | string
  cancelado: boolean; devolvido: boolean; nota_chave: string | null; nota_numero: string | null; nota_serie: string | null
}
export type ItemDb = {
  id: number; venda_id: number; codigo_produto: number | null; nome: string | null; quantidade: number | string
  valor_unitario: number | string; desconto: number | string; valor: number | string; ncm: string | null; cfop: string | null
}
export type PagamentoDb = { venda_id: number; sequencia: number; tipo_doc: string | null; valor: number | string }

export type FatoBulk = {
  cupons: { n_id_cupom: number; chave: string | null; data: string; hora: string | null; num: string | null; serie: string | null; seq_caixa: number | null; id_cliente: number | null; id_vendedor: number | null; valor: number; cancelado: boolean; devolvido: boolean }[]
  itens: { id_item: number; n_id_cupom: number; id_produto: number | null; cfop: string | null; ncm: string | null; quant: number; v_unit: number; v_desc: number; v_item: number; x_prod: string | null }[]
  pagamentos: { n_id_cupom: number; sequencia: number; tipo_doc: string | null; valor: number; categoria: string | null; id_conta_corrente: number | null }[]
}

const num = (v: number | string | null | undefined) => Number(v) || 0

export function montarFatoBulk(vendas: VendaDb[], itens: ItemDb[], pagamentos: PagamentoDb[]): FatoBulk {
  const porId = new Map(vendas.map((v) => [v.id, v]))
  const out: FatoBulk = { cupons: [], itens: [], pagamentos: [] }
  for (const v of vendas) {
    out.cupons.push({
      n_id_cupom: Number(v.n_id_cupom), chave: v.nota_chave, data: String(v.data).slice(0, 10), hora: v.hora,
      num: v.nota_numero, serie: v.nota_serie, seq_caixa: null, id_cliente: null, id_vendedor: null,
      valor: num(v.valor), cancelado: !!v.cancelado, devolvido: !!v.devolvido,
    })
  }
  // Como no Omie: venda cancelada leva só o cabeçalho (itens e pagamentos ficam de fora do fato).
  for (const it of itens) {
    const v = porId.get(it.venda_id)
    if (!v || v.cancelado) continue
    out.itens.push({
      id_item: BASE_ID_ITEM_PROPRIO + Number(it.id), n_id_cupom: Number(v.n_id_cupom), id_produto: it.codigo_produto != null ? Number(it.codigo_produto) : null,
      cfop: it.cfop, ncm: it.ncm, quant: num(it.quantidade), v_unit: num(it.valor_unitario), v_desc: num(it.desconto),
      v_item: num(it.valor), x_prod: it.nome,
    })
  }
  for (const p of pagamentos) {
    const v = porId.get(p.venda_id)
    if (!v || v.cancelado) continue
    out.pagamentos.push({ n_id_cupom: Number(v.n_id_cupom), sequencia: Number(p.sequencia), tipo_doc: p.tipo_doc, valor: num(p.valor), categoria: null, id_conta_corrente: null })
  }
  return out
}

/** Divide em lotes de cupons (a API recusa corpo grande: 2 MB). */
export function lotesDeCupons(fato: FatoBulk, tamanho = 200): FatoBulk[] {
  const lotes: FatoBulk[] = []
  for (let i = 0; i < fato.cupons.length; i += tamanho) {
    const cupons = fato.cupons.slice(i, i + tamanho)
    const ids = new Set(cupons.map((c) => c.n_id_cupom))
    lotes.push({ cupons, itens: fato.itens.filter((x) => ids.has(x.n_id_cupom)), pagamentos: fato.pagamentos.filter((x) => ids.has(x.n_id_cupom)) })
  }
  return lotes
}
