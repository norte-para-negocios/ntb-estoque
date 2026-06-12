'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'

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
    query = query.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
  }

  const { data } = await query.order('descricao')
  return (data ?? []) as ProdutoBusca[]
}
