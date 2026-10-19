import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { custoMedioAtual } from '@/lib/relatorios/cmv-puro'
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
  const { data: ult, error: eUlt } = await supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).neq('codigo_local_estoque', 0)
    .order('data_posicao', { ascending: false }).limit(1).maybeSingle()
  if (eUlt) anotar('data da foto do estoque')(eUlt)
  const dataFoto = ult?.data_posicao ? String(ult.data_posicao) : null

  type Prod = { codigo_produto: number; codigo: string | null; descricao: string | null; descricao_familia: string | null; tipo_item: string | null; unidade: string | null; inativo: boolean | null }
  type Foto = { n_cod_prod: number; codigo_local_estoque: number; n_saldo: number; n_cmc: number }
  const [brutas, prods, foto] = await Promise.all([
    rpcTodos<BrutoPF>(supabase, 'relatorio_produtos_fornecedor', { p_loja_id: lojaId }, anotar('compras por fornecedor')),
    buscarTodasLinhas<Prod>((from, to) => supabase.from('produtos').select('codigo_produto, codigo, descricao, descricao_familia, tipo_item, unidade, inativo')
      .eq('loja_id', lojaId).order('id').range(from, to), undefined, anotar('cadastro de produtos')),
    dataFoto
      ? buscarTodasLinhas<Foto>((from, to) => supabase.from('posicao_estoques').select('n_cod_prod, codigo_local_estoque, n_saldo, n_cmc')
          .eq('loja_id', lojaId).eq('data_posicao', dataFoto).order('id').range(from, to), undefined, anotar('posição de estoque'))
      : Promise.resolve<Foto[]>([]),
  ])
  const custo = custoMedioAtual(foto)
  const saldo = new Map<number, number>()
  for (const f of foto) if (Number(f.codigo_local_estoque) !== 0) saldo.set(Number(f.n_cod_prod), (saldo.get(Number(f.n_cod_prod)) ?? 0) + (Number(f.n_saldo) || 0))
  const meta = new Map<number, MetaPF>(prods.map((p) => [Number(p.codigo_produto), {
    codigo: p.codigo, descricao: p.descricao, familia: p.descricao_familia, tipo: p.tipo_item, unidade: p.unidade, inativo: p.inativo === true,
    custoMedio: custo.get(Number(p.codigo_produto)) ?? null, estoque: Math.round((saldo.get(Number(p.codigo_produto)) ?? 0) * 1e6) / 1e6,
  }]))
  const r = montarProdutosFornecedor(brutas, meta, op)
  const comCompra = new Set(brutas.map((b) => Number(b.n_cod_prod)))
  const doCadastro = prods.filter((p) => comCompra.has(Number(p.codigo_produto)))
  const tipos = [...new Set(doCadastro.map((p) => p.tipo_item ?? ''))].sort().map((c) => ({ value: c || '_', label: rotuloTipo(c) }))
  const familias = [...new Set(doCadastro.map((p) => p.descricao_familia?.trim() || SEM_FAMILIA))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((f) => ({ value: f, label: f }))
  const fornecedores = [...new Set(brutas.map((b) => b.fornecedor))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return { ...r, dataFoto, erros: [...new Set(erros)], opcoes: { tipos, familias, fornecedores }, vazio: brutas.length === 0 }
}
