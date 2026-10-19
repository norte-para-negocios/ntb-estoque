import { createClient } from '@/lib/supabase/server'
import { etapaExibida, type EtapaPedido, type Parcela } from '@/lib/compras/pedido-puro'

// Leitura dos pedidos de compra (sessão do usuário: RLS por loja). Só loja de estoque próprio usa.

export type PedidoResumo = {
  id: number; numero: number; etapa: EtapaPedido; etapaExibida: ReturnType<typeof etapaExibida>
  fornecedorNome: string; previsaoEntrega: string | null; createdAt: string; criadoPorNome: string | null; aprovadoPorNome: string | null
  itens: number; valorItens: number; total: number; qtdBase: number; recebido: number; vinculado: number
  fornecedorCnpj: string | null; updatedAt: string; origem: string
  /** 240 (comprador_id); null sem a migration */
  compradorId: number | null
}

export type ItemSituacao = {
  id: number; linha: number; codigoProduto: number; descricao: string; unidade: string | null; fator: number; quantidade: number; precoUnitario: number
  codigoLocal: number | null; obs: string | null; quantidadeBase: number; precoBase: number; vinculado: number; recebido: number
}

const n = (v: unknown) => Number(v ?? 0) || 0
const COLS = 'id, numero, etapa, fornecedor_id, fornecedor_nome, fornecedor_cnpj, previsao_entrega, frete, outras_despesas, parcelas, numero_fornecedor, contato, obs, obs_interna, origem, criado_por_nome, aprovado_por_nome, aprovado_em, cancelado_por_nome, cancelado_em, motivo_cancelamento, created_at, updated_at'

type Cab = {
  id: number; numero: number; etapa: EtapaPedido; fornecedor_id: number | null; fornecedor_nome: string; fornecedor_cnpj: string | null; previsao_entrega: string | null
  frete: number; outras_despesas: number; parcelas: Parcela[]; numero_fornecedor: string | null; contato: string | null; obs: string | null; obs_interna: string | null
  origem: string; criado_por_nome: string | null; aprovado_por_nome: string | null; aprovado_em: string | null; cancelado_por_nome: string | null
  cancelado_em: string | null; motivo_cancelamento: string | null; created_at: string; updated_at: string
}

function itemDe(r: Record<string, unknown>): ItemSituacao {
  return {
    id: n(r.id), linha: n(r.linha), codigoProduto: n(r.codigo_produto), descricao: String(r.descricao ?? ''), unidade: (r.unidade as string) ?? null,
    fator: n(r.fator) || 1, quantidade: n(r.quantidade), precoUnitario: n(r.preco_unitario), codigoLocal: r.codigo_local_estoque == null ? null : n(r.codigo_local_estoque),
    obs: (r.obs as string) ?? null, quantidadeBase: n(r.quantidade_base), precoBase: n(r.preco_base), vinculado: n(r.vinculado), recebido: n(r.recebido),
  }
}

function resumir(c: Cab, itens: ItemSituacao[], compradorId: number | null = null): PedidoResumo {
  const valorItens = Math.round(itens.reduce((a, i) => a + i.quantidade * i.precoUnitario, 0) * 100) / 100
  const qtdBase = itens.reduce((a, i) => a + i.quantidadeBase, 0)
  const recebido = itens.reduce((a, i) => a + Math.min(i.recebido, i.quantidadeBase), 0)
  return {
    id: c.id, numero: c.numero, etapa: c.etapa, etapaExibida: etapaExibida(c.etapa, { pedido: qtdBase, recebido }),
    fornecedorNome: c.fornecedor_nome, previsaoEntrega: c.previsao_entrega, createdAt: c.created_at, criadoPorNome: c.criado_por_nome, aprovadoPorNome: c.aprovado_por_nome,
    itens: itens.length, valorItens, total: Math.round((valorItens + n(c.frete) + n(c.outras_despesas)) * 100) / 100, qtdBase, recebido,
    vinculado: itens.reduce((a, i) => a + i.vinculado, 0),
    fornecedorCnpj: c.fornecedor_cnpj, updatedAt: c.updated_at, origem: c.origem, compradorId,
  }
}

/** comprador_id vem à parte: sem a migration 240 a coluna não existe e a tela segue sem comprador. */
async function compradoresDosPedidos(lojaId: number, ids: number[]): Promise<Map<number, number | null>> {
  const m = new Map<number, number | null>()
  if (!ids.length) return m
  const sb = await createClient()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('pedidos_compra').select('id, comprador_id').eq('loja_id', lojaId).in('id', ids.slice(i, i + 200))
    if (error) return new Map()
    for (const r of (data ?? []) as { id: number; comprador_id: number | null }[]) m.set(Number(r.id), r.comprador_id == null ? null : Number(r.comprador_id))
  }
  return m
}

/** Os 300 pedidos mais recentes da loja (o filtro de etapa/fornecedor/número é feito na página). */
export async function listarPedidos(lojaId: number): Promise<{ pedidos: PedidoResumo[]; erro: string | null }> {
  const sb = await createClient()
  const { data, error } = await sb.from('pedidos_compra').select(COLS).eq('loja_id', lojaId).order('numero', { ascending: false }).limit(300)
  if (error) return { pedidos: [], erro: 'Pedidos de compra ainda não ativados nesta instalação (migration 200).' }
  const cabs = (data ?? []) as unknown as Cab[]
  const ids = cabs.map((c) => c.id)
  const itens = new Map<number, ItemSituacao[]>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data: its } = await sb.from('pedidos_compra_itens_situacao').select('*').eq('loja_id', lojaId).in('pedido_id', ids.slice(i, i + 100)).order('id').limit(5000)
    for (const r of (its ?? []) as Record<string, unknown>[]) itens.set(n(r.pedido_id), [...(itens.get(n(r.pedido_id)) ?? []), itemDe(r)])
  }
  const comps = await compradoresDosPedidos(lojaId, ids)
  return { pedidos: cabs.map((c) => resumir(c, itens.get(c.id) ?? [], comps.get(c.id) ?? null)), erro: null }
}

export type NotaVinculada = { compraId: number; notaId: number | null; numero: string | null; emissao: string | null; status: string; itens: number }
export type EventoPedido = { id: number; tipo: string; de: string | null; para: string | null; detalhe: Record<string, unknown>; userNome: string | null; em: string }

export async function carregarPedido(lojaId: number, id: number): Promise<{
  cab: Cab; resumo: PedidoResumo; itens: ItemSituacao[]; notas: NotaVinculada[]; eventos: EventoPedido[]; locais: Map<number, string>; codigos: Map<number, string>
} | null> {
  const sb = await createClient()
  const { data: c } = await sb.from('pedidos_compra').select(COLS).eq('loja_id', lojaId).eq('id', id).maybeSingle()
  if (!c) return null
  const cab = c as unknown as Cab
  const [{ data: its }, { data: vincs }, { data: evs }, { data: locs }] = await Promise.all([
    sb.from('pedidos_compra_itens_situacao').select('*').eq('loja_id', lojaId).eq('pedido_id', id).order('linha'),
    sb.from('pedidos_compra_vinculos').select('compra_id, compra_item_id').eq('loja_id', lojaId).eq('pedido_id', id),
    sb.from('pedidos_compra_eventos').select('id, tipo, de_etapa, para_etapa, detalhe, user_nome, created_at').eq('loja_id', lojaId).eq('pedido_id', id).order('id'),
    sb.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId),
  ])
  const itens = ((its ?? []) as Record<string, unknown>[]).map(itemDe)
  const porCompra = new Map<number, number>()
  for (const v of vincs ?? []) porCompra.set(n(v.compra_id), (porCompra.get(n(v.compra_id)) ?? 0) + 1)
  let notas: NotaVinculada[] = []
  if (porCompra.size) {
    const { data: cs } = await sb.from('compras_proprio').select('id, nota_fiscal_id, numero, emissao, status').eq('loja_id', lojaId).in('id', [...porCompra.keys()])
    notas = (cs ?? []).map((x) => ({ compraId: n(x.id), notaId: x.nota_fiscal_id == null ? null : n(x.nota_fiscal_id), numero: x.numero, emissao: x.emissao, status: x.status, itens: porCompra.get(n(x.id)) ?? 0 }))
  }
  const codigos = new Map<number, string>()
  if (itens.length) {
    const { data: ps } = await sb.from('produtos').select('codigo_produto, codigo').eq('loja_id', lojaId).in('codigo_produto', [...new Set(itens.map((i) => i.codigoProduto))])
    for (const p of ps ?? []) codigos.set(n(p.codigo_produto), p.codigo)
  }
  return {
    cab, resumo: resumir(cab, itens, (await compradoresDosPedidos(lojaId, [cab.id])).get(cab.id) ?? null), itens, notas,
    eventos: (evs ?? []).map((e) => ({ id: n(e.id), tipo: e.tipo, de: e.de_etapa, para: e.para_etapa, detalhe: (e.detalhe ?? {}) as Record<string, unknown>, userNome: e.user_nome, em: e.created_at })),
    locais: new Map((locs ?? []).map((l) => [n(l.codigo_local_estoque), l.descricao as string])),
    codigos,
  }
}
