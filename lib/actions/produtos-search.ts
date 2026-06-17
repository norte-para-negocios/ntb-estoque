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
  const t = termo.trim()
  // Termo so com numeros = busca por CODIGO (ex.: "70" para os produtos 70mil).
  const ehCodigo = /^\d+$/.test(t)

  let query = supabase
    .from('produtos')
    .select('codigo_produto, codigo, descricao, descricao_familia, unidade')
    .eq('loja_id', lojaId)
    // Limite maior: o limite de 20 cortava produtos (faltavam itens na busca da OP).
    .limit(50)

  if (t) {
    const e = escapeIlikeOr(t)
    query = query.or(`descricao.ilike.%${e}%,codigo.ilike.%${e}%`)
  }

  // Numerico -> ordena por codigo (os 70xxx saem juntos e em ordem, em vez de
  // 20 itens alfabeticos por descricao); texto -> ordena por descricao.
  query = ehCodigo ? query.order('codigo') : query.order('descricao')

  const { data } = await query
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
