import { createClient, createServiceClient } from '@/lib/supabase/server'
import { cfopDevolucao, devolvivel, type SituacaoDevolucao } from '@/lib/compras/devolucao-puro'

// Fase F [H1]: o que dá para devolver de uma nota de entrada do estoque próprio e as devoluções já registradas.
// Sem a migration 231 a seção some (null).

export type ItemDevolvivel = {
  compraItemId: number; linha: number; descricao: string; codigoProduto: number; unidade: string
  recebido: number; devolvido: number; disponivel: number; custoUnitario: number; cfop: string
}
export type DevolucaoResumo = {
  id: number; numero: number; situacao: SituacaoDevolucao; data: string; motivo: string; valorCusto: number; valorFiscal: number
  criadoPor: string | null; canceladoPor: string | null; motivoCancelamento: string | null
  itens: { linha: number; descricao: string; quantidade: number; custoUnitario: number; cfop: string | null }[]
}
export type DevolucoesDaNota = { itens: ItemDevolvivel[]; devolucoes: DevolucaoResumo[] }

const n = (v: unknown) => Number(v ?? 0) || 0

/** Quantidade ainda devolvível por item lançado da compra (unidade de estoque) — usada também pela ação. */
export async function disponiveisDaCompra(lojaId: number, compraId: number, sbArg?: Awaited<ReturnType<typeof createClient>>): Promise<ItemDevolvivel[] | null> {
  const sb = sbArg ?? createServiceClient()
  const { data: itens, error } = await sb.from('compras_proprio_itens')
    .select('id, linha, descricao, codigo_produto, movimento_id, cfop_entrada, cfop, custo_unitario_base')
    .eq('loja_id', lojaId).eq('compra_id', compraId).eq('lancado', true).not('movimento_id', 'is', null).order('linha')
  if (error) return null
  const lista = itens ?? []
  if (!lista.length) return []
  const movIds = lista.map((i) => n(i.movimento_id))
  const itemIds = lista.map((i) => n(i.id))
  const prods = [...new Set(lista.map((i) => n(i.codigo_produto)))]
  const [{ data: movs }, { data: devs, error: eDev }, { data: ps }] = await Promise.all([
    sb.from('estoque_movimentos').select('id, quantidade, custo_unitario').eq('loja_id', lojaId).in('id', movIds),
    sb.from('devolucoes_fornecedor_itens').select('compra_item_id, quantidade, devolucao:devolucoes_fornecedor(situacao)').eq('loja_id', lojaId).in('compra_item_id', itemIds),
    sb.from('produtos').select('codigo_produto, unidade').eq('loja_id', lojaId).in('codigo_produto', prods),
  ])
  if (eDev) return null // migration 231 não aplicada
  const mov = new Map((movs ?? []).map((m) => [n(m.id), m]))
  const un = new Map((ps ?? []).map((p) => [n(p.codigo_produto), String(p.unidade ?? '')]))
  const devolvido = new Map<number, number>()
  for (const d of devs ?? []) {
    const sit = (d.devolucao as unknown as { situacao?: string } | null)?.situacao
    if (sit === 'cancelada') continue
    devolvido.set(n(d.compra_item_id), (devolvido.get(n(d.compra_item_id)) ?? 0) + n(d.quantidade))
  }
  return lista.map((i) => {
    const m = mov.get(n(i.movimento_id))
    const recebido = n(m?.quantidade)
    const dev = devolvido.get(n(i.id)) ?? 0
    return {
      compraItemId: n(i.id), linha: n(i.linha), descricao: String(i.descricao ?? ''), codigoProduto: n(i.codigo_produto),
      unidade: un.get(n(i.codigo_produto)) ?? '', recebido, devolvido: dev, disponivel: devolvivel(recebido, dev),
      custoUnitario: n(m?.custo_unitario) || n(i.custo_unitario_base), cfop: cfopDevolucao(i.cfop_entrada ?? null),
    }
  })
}

export async function carregarDevolucoesDaNota(lojaId: number, compraId: number): Promise<DevolucoesDaNota | null> {
  const sb = await createClient()
  const itens = await disponiveisDaCompra(lojaId, compraId, sb)
  if (itens === null) return null
  const { data: devs, error } = await sb.from('devolucoes_fornecedor')
    .select('id, numero, situacao, data, motivo, valor_custo, valor_fiscal, criado_por_nome, cancelado_por_nome, motivo_cancelamento, itens:devolucoes_fornecedor_itens(linha, descricao, quantidade, custo_unitario, cfop)')
    .eq('loja_id', lojaId).eq('compra_id', compraId).order('numero', { ascending: false })
  if (error) return null
  return {
    itens,
    devolucoes: (devs ?? []).map((d) => ({
      id: n(d.id), numero: n(d.numero), situacao: d.situacao as SituacaoDevolucao, data: String(d.data), motivo: String(d.motivo ?? ''),
      valorCusto: n(d.valor_custo), valorFiscal: n(d.valor_fiscal), criadoPor: d.criado_por_nome ?? null, canceladoPor: d.cancelado_por_nome ?? null,
      motivoCancelamento: d.motivo_cancelamento ?? null,
      itens: ((d.itens ?? []) as { linha: number; descricao: string | null; quantidade: number; custo_unitario: number; cfop: string | null }[])
        .sort((a, b) => a.linha - b.linha)
        .map((i) => ({ linha: n(i.linha), descricao: String(i.descricao ?? ''), quantidade: n(i.quantidade), custoUnitario: n(i.custo_unitario), cfop: i.cfop })),
    })),
  }
}
