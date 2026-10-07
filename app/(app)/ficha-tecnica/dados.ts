import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { carregarFichasAtivas } from '@/lib/estoque/receita-db'
import { custoUnitarioFicha, type Ficha } from '@/lib/estoque/receita'

export type ProdutoBase = { codigoProduto: number; codigo: string; descricao: string; unidade: string; tipoItem: string | null }
export type FichaAtiva = Ficha & { fichaId: number; versao: number }
export type VersaoFicha = { id: number; versao: number; ativa: boolean; rendimento: number; criadaPor: string | null; obs: string | null; criadaEm: string; nItens: number }

type ProdutoRow = { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null; tipo_item: string | null }

export async function carregarBase(lojaId: number) {
  const supabase = await createClient()
  const [produtosRaw, custosRaw, fichas] = await Promise.all([
    buscarTodasLinhas<ProdutoRow>((from, to) =>
      supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade, tipo_item')
        .eq('loja_id', lojaId).neq('inativo', true).order('id').range(from, to)),
    buscarTodasLinhas<{ codigo_produto: number; cmc: number }>((from, to) =>
      supabase.from('estoque_custos').select('codigo_produto, cmc').eq('loja_id', lojaId).order('codigo_produto').range(from, to)),
    carregarFichasAtivas(supabase, lojaId),
  ])
  const produtos: ProdutoBase[] = produtosRaw.map((p) => ({
    codigoProduto: Number(p.codigo_produto), codigo: p.codigo ?? '', descricao: p.descricao ?? '(sem nome)', unidade: p.unidade ?? 'UN', tipoItem: p.tipo_item,
  }))
  const cmc = new Map<number, number>(custosRaw.map((c) => [Number(c.codigo_produto), Number(c.cmc)]))
  return { supabase, produtos, cmc, fichas: fichas as Map<number, FichaAtiva> }
}

export type LinhaFicha = {
  produto: ProdutoBase
  versao: number
  rendimento: number
  nInsumos: number
  custoUnitario: number | null
  expandirNaVenda: boolean
}

export async function carregarListaFichas(lojaId: number) {
  const { produtos, cmc, fichas } = await carregarBase(lojaId)
  const porCodigo = new Map(produtos.map((p) => [p.codigoProduto, p]))
  const linhas: LinhaFicha[] = []
  for (const [codigo, f] of fichas) {
    const produto = porCodigo.get(codigo)
    if (!produto) continue
    let custo: number | null = null
    try { custo = custoUnitarioFicha(fichas, cmc, codigo) } catch { custo = null }
    linhas.push({ produto, versao: f.versao, rendimento: f.rendimento, nInsumos: f.itens.length, custoUnitario: custo, expandirNaVenda: f.expandirNaVenda })
  }
  linhas.sort((a, b) => a.produto.descricao.localeCompare(b.produto.descricao, 'pt-BR'))
  // Produtos que costumam ter receita (acabado 04, intermediário 03/06, revenda 00 não) e ainda não têm.
  const semFicha = produtos.filter((p) => !fichas.has(p.codigoProduto))
  const vendaveisSemFicha = semFicha.filter((p) => p.tipoItem === '04' || p.tipoItem === '03' || p.tipoItem === '06').length
  return { linhas, semFicha, vendaveisSemFicha, totalProdutos: produtos.length }
}

export async function carregarVersoes(lojaId: number, codigoProduto: number): Promise<VersaoFicha[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('fichas_tecnicas').select('id, versao, ativa, rendimento, criada_por, obs, created_at')
    .eq('loja_id', lojaId).eq('codigo_produto', codigoProduto).order('versao', { ascending: false }).limit(50)
  const lista = (data ?? []) as { id: number; versao: number; ativa: boolean; rendimento: number; criada_por: string | null; obs: string | null; created_at: string }[]
  const ids = lista.map((f) => f.id)
  const contagem = new Map<number, number>()
  if (ids.length) {
    const { data: itens } = await supabase.from('ficha_tecnica_itens').select('ficha_id').in('ficha_id', ids).limit(5000)
    for (const i of (itens ?? []) as { ficha_id: number }[]) contagem.set(i.ficha_id, (contagem.get(i.ficha_id) ?? 0) + 1)
  }
  return lista.map((f) => ({ id: f.id, versao: f.versao, ativa: f.ativa, rendimento: Number(f.rendimento), criadaPor: f.criada_por, obs: f.obs, criadaEm: f.created_at, nItens: contagem.get(f.id) ?? 0 }))
}
