// Cadastro mínimo dos produtos da loja (nome, código, unidade, tipo) para as telas de auditoria.
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

export type ProdutoMin = { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null; tipo_item: string | null; inativo: boolean | null }

/** Todos os produtos da loja (inclusive inativos: ajuste antigo pode ser de produto desativado). */
export async function carregarProdutosMin(lojaId: number): Promise<Map<number, ProdutoMin>> {
  const supabase = await createClient()
  const rows = await buscarTodasLinhas<ProdutoMin>((from, to) =>
    supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade, tipo_item, inativo').eq('loja_id', lojaId).order('id').range(from, to))
  return new Map(rows.map((p) => [Number(p.codigo_produto), p]))
}

export async function carregarLocais(lojaId: number): Promise<Map<number, string>> {
  const supabase = await createClient()
  const { data } = await supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId)
  return new Map((data ?? []).map((l) => [Number(l.codigo_local_estoque), (l.descricao as string) ?? String(l.codigo_local_estoque)]))
}
