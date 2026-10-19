import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { carregarCustoESaldo } from '@/lib/relatorios/custo-medio-loader'
import { rotuloTipo } from '@/lib/relatorios/posicao-estoque-loader'
import { montarProdutosFornecedor, SEM_FAMILIA, type BrutoPF, type MetaPF, type OpcoesPF } from '@/lib/relatorios/produtos-fornecedor-puro'

export type SpPF = Record<string, string | undefined>
const lista = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

export function lerOpcoesPF(sp: SpPF): OpcoesPF {
  return {
    ver: sp.ver === 'fornecedor' ? 'fornecedor' : 'produto', q: (sp.q ?? '').slice(0, 80), fornecedor: (sp.fornecedor ?? '').slice(0, 80),
    tipos: lista(sp.tipo), familias: lista(sp.familia), inativos: sp.inativos !== '0',
  }
}
export function paramsBasePF(o: OpcoesPF): Record<string, string> {
  return { ver: o.ver === 'produto' ? '' : o.ver, q: o.q, fornecedor: o.fornecedor, tipo: o.tipos.join(','), familia: o.familias.join(','), inativos: o.inativos ? '' : '0' }
}

// Produtos por fornecedor nos dois modos: a RPC relatorio_produtos_fornecedor (migration 210) despacha pelo modo da loja
// (Omie = notas concluídas; próprio = compras lançadas). Cadastro e custo médio de hoje vêm de produtos e da foto mais
// recente com local real de posicao_estoques (lojas Omie = sync; própria = projeção do ledger).
export async function carregarProdutosFornecedor(lojaId: number, op: OpcoesPF) {
  const supabase = await createClient()
  const erros: string[] = []
  const anotar = (onde: string) => (e: { message: string }) => { erros.push(onde); console.error(`produtos-fornecedor: ${onde}`, e.message) }
  type Prod = { codigo_produto: number; codigo: string | null; descricao: string | null; descricao_familia: string | null; tipo_item: string | null; unidade: string | null; inativo: boolean | null }
  const [brutas, prods, { custo, saldo, dataFoto }] = await Promise.all([
    // a função devolve um jsonb só (uma chamada; sem paginação que refaria a função a cada página)
    supabase.rpc('relatorio_produtos_fornecedor', { p_loja_id: lojaId }).then(({ data, error }) => {
      if (error) anotar('compras por fornecedor')(error)
      return (Array.isArray(data) ? data : []) as BrutoPF[]
    }),
    buscarTodasLinhas<Prod>((from, to) => supabase.from('produtos').select('codigo_produto, codigo, descricao, descricao_familia, tipo_item, unidade, inativo')
      .eq('loja_id', lojaId).order('id').range(from, to), undefined, anotar('cadastro de produtos')),
    carregarCustoESaldo(lojaId, (onde) => erros.push(onde)),
  ])
  const meta = new Map<number, MetaPF>(prods.map((p) => [Number(p.codigo_produto), {
    codigo: p.codigo, descricao: p.descricao, familia: p.descricao_familia, tipo: p.tipo_item, unidade: p.unidade, inativo: p.inativo === true,
    custoMedio: custo.get(Number(p.codigo_produto)) ?? null, estoque: saldo.get(Number(p.codigo_produto)) ?? 0,
  }]))
  const r = montarProdutosFornecedor(brutas, meta, op)
  const comCompra = new Set(brutas.map((b) => Number(b.n_cod_prod)))
  const doCadastro = prods.filter((p) => comCompra.has(Number(p.codigo_produto)))
  const tipos = [...new Set(doCadastro.map((p) => p.tipo_item ?? ''))].sort().map((c) => ({ value: c || '_', label: rotuloTipo(c) }))
  const familias = [...new Set(doCadastro.map((p) => p.descricao_familia?.trim() || SEM_FAMILIA))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((f) => ({ value: f, label: f }))
  const fornecedores = [...new Set(brutas.map((b) => b.fornecedor))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return { ...r, dataFoto, erros: [...new Set(erros)], opcoes: { tipos, familias, fornecedores }, vazio: brutas.length === 0 }
}
