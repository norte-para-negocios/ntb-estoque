'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { formatarNomeProduto } from '@/lib/formatar-nome'

export type ProdutoBusca = {
  codigo_produto: number
  codigo: string
  descricao: string
  descricao_familia: string | null
  unidade: string
}

export async function buscarProdutos(termo: string): Promise<ProdutoBusca[]> {
  const lojaId = await getCurrentLojaId()
  const supabase = await createClient()
  let query = supabase
    .from('produtos')
    .select('codigo_produto, codigo, descricao, descricao_familia, unidade')
    .eq('loja_id', lojaId)
    .limit(20)

  if (termo.trim()) {
    const t = escapeIlikeOr(termo)
    query = query.or(`descricao.ilike.%${t}%,codigo.ilike.%${t}%`)
  }

  const { data } = await query.order('descricao')
  return (data ?? []).map((p) => ({ ...p, descricao: formatarNomeProduto(p.descricao) })) as ProdutoBusca[]
}

export async function buscarProdutoPorCodigo(codigo: string): Promise<ProdutoBusca | null> {
  const termo = codigo.trim()
  if (!termo) return null
  const lojaId = await getCurrentLojaId()
  const supabase = await createClient()
  const { data } = await supabase
    .from('produtos')
    .select('codigo_produto, codigo, descricao, descricao_familia, unidade')
    .eq('loja_id', lojaId)
    .eq('codigo', termo)
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { ...data, descricao: formatarNomeProduto(data.descricao) } as ProdutoBusca
}
