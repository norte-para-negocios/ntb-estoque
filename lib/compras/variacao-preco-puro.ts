// T5.4 (Fase 5): alerta de variação de preço do insumo na nota. Módulo puro (sem imports @/) para `node --test`.
// A função SQL variacao_preco_compras (migration 400) devolve, por item, o preço por unidade de estoque
// ((valor dos produtos − desconto) ÷ quantidade recebida) e o da compra anterior do produto (ou o custo médio atual).
// Aqui se aplica o limite da loja (estoque_config.alerta_variacao_preco_pct, padrão 15%): alerta quando a variação passa
// do limite, para cima ou para baixo (preço muito menor costuma ser unidade errada na nota).

export const LIMITE_PADRAO_PCT = 15

export type LinhaPrecoDb = {
  compra_id: number | string
  nota_fiscal_id: number | string | null
  numero: string | null
  fornecedor_nome: string | null
  data_compra: string
  status: string
  item_id: number | string
  linha: number | string
  codigo_produto: number | string
  descricao: string | null
  quantidade_base: number | string | null
  preco_base: number | string | null
  preco_anterior: number | string | null
  data_anterior: string | null
  compra_anterior: number | string | null
  fonte_anterior: 'compra' | 'cmc' | null
  variacao_pct: number | string | null
}

/** Limite digitado ou gravado: número em (0, 1000]. `null`/vazio = padrão; inválido = null (a tela recusa). */
export function lerLimitePct(v: unknown): number | null {
  if (v == null || v === '') return LIMITE_PADRAO_PCT
  const x = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(x) && x > 0 && x <= 1000 ? x : null
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ')
const pctTxt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const dataBR = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }

export type AlertaPreco = { sentido: 'subiu' | 'caiu'; pct: number; texto: string }

export function alertaDePreco(l: LinhaPrecoDb, limitePct: number): AlertaPreco | null {
  if (l.variacao_pct == null || l.preco_base == null || l.preco_anterior == null || !l.fonte_anterior) return null
  const pct = Number(l.variacao_pct)
  if (!Number.isFinite(pct) || Math.abs(pct) <= limitePct) return null
  const sentido = pct > 0 ? 'subiu' : 'caiu'
  const atual = brl(Number(l.preco_base))
  const antes = brl(Number(l.preco_anterior))
  const lado = sentido === 'subiu' ? 'acima' : 'abaixo'
  const texto = l.fonte_anterior === 'compra'
    ? `Preço ${pctTxt(Math.abs(pct))}% ${lado} da última compra (${atual} por unidade; antes ${antes}${l.data_anterior ? ` em ${dataBR(l.data_anterior)}` : ''})`
    : `Preço ${pctTxt(Math.abs(pct))}% ${lado} do custo médio (${atual} por unidade; custo médio ${antes})`
  return { sentido, pct, texto }
}

export type ItemComAlerta = {
  itemId: number
  compraId: number
  notaId: number | null
  numero: string | null
  fornecedor: string | null
  data: string
  status: string
  produto: number
  descricao: string | null
  precoBase: number
  precoAnterior: number
  fonte: 'compra' | 'cmc'
  alerta: AlertaPreco
}

/** Só os itens com alerta, maior variação (absoluta) primeiro. */
export function alertasDaLista(rows: LinhaPrecoDb[], limitePct: number): ItemComAlerta[] {
  const out: ItemComAlerta[] = []
  for (const r of rows) {
    const a = alertaDePreco(r, limitePct)
    if (!a) continue
    out.push({
      itemId: Number(r.item_id), compraId: Number(r.compra_id), notaId: r.nota_fiscal_id == null ? null : Number(r.nota_fiscal_id),
      numero: r.numero, fornecedor: r.fornecedor_nome, data: r.data_compra, status: r.status, produto: Number(r.codigo_produto),
      descricao: r.descricao, precoBase: Number(r.preco_base), precoAnterior: Number(r.preco_anterior), fonte: r.fonte_anterior!, alerta: a,
    })
  }
  return out.sort((a, b) => Math.abs(b.alerta.pct) - Math.abs(a.alerta.pct) || a.itemId - b.itemId)
}
