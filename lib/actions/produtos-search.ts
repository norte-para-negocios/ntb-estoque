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

export async function buscarProdutos(
  termo: string,
  filtros?: { tipo?: string; familia?: string }
): Promise<ProdutoBusca[]> {
  const lojaId = await getCurrentLojaId()
  const supabase = await createClient()
  const t = termo.trim()
  // Termo so com numeros = busca por CODIGO (ex.: "70" para os produtos 70mil).
  const ehCodigo = /^\d+$/.test(t)
  // Cada palavra vira um filtro AND: "arroz tipo 1" acha "ARROZ AGULHINHA TIPO 1"
  // mesmo fora de ordem (busca por palavras, nao pela frase literal). Cada palavra
  // pode bater na descricao OU no codigo. Limite de 6 palavras evita query gigante.
  const palavras = t.split(/\s+/).filter(Boolean).slice(0, 6)

  let query = supabase
    .from('produtos')
    .select('codigo_produto, codigo, descricao, descricao_familia, unidade')
    .eq('loja_id', lojaId)
    // Limite maior: o limite de 20 cortava produtos (faltavam itens na busca da OP).
    .limit(50)

  for (const palavra of palavras) {
    const e = escapeIlikeOr(palavra)
    // .or() de cada palavra ja vira AND com os demais .or() (descricao OU codigo).
    query = query.or(`descricao.ilike.%${e}%,codigo.ilike.%${e}%`)
  }
  // Filtros para navegar/escolher por tipo (revenda/produção...) e familia.
  if (filtros?.tipo) query = query.eq('tipo_item', filtros.tipo)
  if (filtros?.familia) query = query.eq('descricao_familia', filtros.familia)

  // Numerico -> ordena por codigo (os 70xxx saem juntos e em ordem, em vez de
  // 20 itens alfabeticos por descricao); texto -> ordena por descricao.
  query = ehCodigo ? query.order('codigo') : query.order('descricao')

  const { data } = await query
  const linhas = (data ?? []).map((p) => ({ ...p, descricao: formatarNomeProduto(p.descricao) })) as ProdutoBusca[]

  // Ordenacao por relevancia (so para texto): quem comeca com o termo aparece
  // primeiro, depois match exato de palavra inteira, depois o resto alfabetico.
  if (!ehCodigo && palavras.length) {
    const primeira = palavras[0].toLowerCase()
    const rank = (d: string) => {
      const desc = d.toLowerCase()
      if (desc.startsWith(primeira)) return 0
      if (new RegExp(`\\b${primeira.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(desc)) return 1
      return 2
    }
    linhas.sort((a, b) => rank(a.descricao) - rank(b.descricao) || a.descricao.localeCompare(b.descricao))
  }
  return linhas
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
