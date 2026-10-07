import { createClient } from '@/lib/supabase/server'

export type StatusCompra = 'pendente' | 'parcial' | 'lancada' | 'cancelada'

export type CompraLinha = {
  id: number
  origem: 'manual' | 'xml'
  numero: string | null
  serie: string | null
  fornecedorNome: string | null
  fornecedorCnpj: string | null
  emissao: string | null
  valorTotal: number
  valorFrete: number
  status: StatusCompra
  criadaEm: string
  nItens: number
  nPendentes: number
}

export type ItemCompra = {
  id: number
  linha: number
  cProd: string | null
  descricao: string | null
  ncm: string | null
  cfop: string | null
  unidadeCompra: string | null
  quantidade: number
  valorUnitario: number
  valorTotal: number
  desconto: number
  fator: number
  codigoProduto: number | null
  custoUnitarioBase: number | null
  lancado: boolean
  produto: { codigo: string; descricao: string; unidade: string } | null
}

export type CompraDetalhe = CompraLinha & {
  chaveAcesso: string | null
  valorProdutos: number
  valorDesconto: number
  icmsRecuperavel: boolean
  codigoLocal: number | null
  local: string | null
  obs: string | null
  lancadaEm: string | null
  itens: ItemCompra[]
}

type CompraRow = {
  id: number; origem: 'manual' | 'xml'; numero: string | null; serie: string | null; fornecedor_nome: string | null; fornecedor_cnpj: string | null
  emissao: string | null; valor_total: number; valor_frete: number; status: StatusCompra; created_at: string
}

export async function carregarCompras(lojaId: number, limite = 300): Promise<CompraLinha[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('compras_proprio')
    .select('id, origem, numero, serie, fornecedor_nome, fornecedor_cnpj, emissao, valor_total, valor_frete, status, created_at')
    .eq('loja_id', lojaId).order('created_at', { ascending: false }).limit(limite)
  const compras = (data ?? []) as CompraRow[]
  const ids = compras.map((c) => c.id)
  const contagem = new Map<number, { n: number; p: number }>()
  if (ids.length) {
    const { data: itens } = await supabase.from('compras_proprio_itens').select('compra_id, lancado').in('compra_id', ids).limit(20000)
    for (const i of (itens ?? []) as { compra_id: number; lancado: boolean }[]) {
      const c = contagem.get(i.compra_id) ?? { n: 0, p: 0 }
      c.n++; if (!i.lancado) c.p++
      contagem.set(i.compra_id, c)
    }
  }
  return compras.map((c) => ({
    id: c.id, origem: c.origem, numero: c.numero, serie: c.serie, fornecedorNome: c.fornecedor_nome, fornecedorCnpj: c.fornecedor_cnpj,
    emissao: c.emissao, valorTotal: Number(c.valor_total), valorFrete: Number(c.valor_frete), status: c.status, criadaEm: c.created_at,
    nItens: contagem.get(c.id)?.n ?? 0, nPendentes: c.status === 'cancelada' ? 0 : contagem.get(c.id)?.p ?? 0,
  }))
}

export async function carregarCompra(lojaId: number, id: number): Promise<CompraDetalhe | null> {
  const supabase = await createClient()
  const { data: c } = await supabase.from('compras_proprio').select('*').eq('loja_id', lojaId).eq('id', id).maybeSingle()
  if (!c) return null
  const { data: itensRaw } = await supabase.from('compras_proprio_itens').select('*').eq('compra_id', id).order('linha')
  const itens = (itensRaw ?? []) as Record<string, unknown>[]
  const codigos = [...new Set(itens.map((i) => i.codigo_produto).filter((x): x is number => typeof x === 'number'))]
  const prods = new Map<number, { codigo: string; descricao: string; unidade: string }>()
  if (codigos.length) {
    const { data } = await supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', codigos)
    for (const p of data ?? []) prods.set(Number(p.codigo_produto), { codigo: p.codigo, descricao: p.descricao, unidade: p.unidade })
  }
  let local: string | null = null
  if (c.codigo_local_estoque) {
    const { data } = await supabase.from('local_estoques').select('descricao').eq('loja_id', lojaId).eq('codigo_local_estoque', c.codigo_local_estoque).maybeSingle()
    local = data?.descricao ?? null
  }
  const nPend = itens.filter((i) => !i.lancado).length
  return {
    id: c.id, origem: c.origem, numero: c.numero, serie: c.serie, fornecedorNome: c.fornecedor_nome, fornecedorCnpj: c.fornecedor_cnpj,
    emissao: c.emissao, valorTotal: Number(c.valor_total), valorFrete: Number(c.valor_frete), status: c.status, criadaEm: c.created_at,
    nItens: itens.length, nPendentes: c.status === 'cancelada' ? 0 : nPend,
    chaveAcesso: c.chave_acesso, valorProdutos: Number(c.valor_produtos), valorDesconto: Number(c.valor_desconto),
    icmsRecuperavel: !!c.icms_recuperavel, codigoLocal: c.codigo_local_estoque, local, obs: c.obs, lancadaEm: c.lancada_em,
    itens: itens.map((i) => ({
      id: Number(i.id), linha: Number(i.linha), cProd: (i.c_prod as string) ?? null, descricao: (i.descricao as string) ?? null,
      ncm: (i.ncm as string) ?? null, cfop: (i.cfop as string) ?? null, unidadeCompra: (i.unidade_compra as string) ?? null,
      quantidade: Number(i.quantidade), valorUnitario: Number(i.valor_unitario), valorTotal: Number(i.valor_total), desconto: Number(i.desconto),
      fator: Number(i.fator), codigoProduto: (i.codigo_produto as number) ?? null,
      custoUnitarioBase: i.custo_unitario_base == null ? null : Number(i.custo_unitario_base), lancado: !!i.lancado,
      produto: typeof i.codigo_produto === 'number' ? prods.get(i.codigo_produto) ?? null : null,
    })),
  }
}

export async function carregarLocais(lojaId: number): Promise<{ codigoLocal: number; descricao: string; padrao: boolean }[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('local_estoques').select('codigo_local_estoque, descricao, padrao, inativo').eq('loja_id', lojaId).order('descricao')
  return (data ?? []).filter((l) => l.inativo !== 'S' && l.inativo !== true).map((l) => ({ codigoLocal: Number(l.codigo_local_estoque), descricao: l.descricao, padrao: l.padrao === 'S' }))
}
