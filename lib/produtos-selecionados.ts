import { createClient } from '@/lib/supabase/server'
import { escapeIlikeOr, buscarTudoPaginado } from '@/lib/utils-busca'

export interface FiltroProdutosSelecao {
  q?: string
  familia?: string
  tipo?: string
  situacao?: string
  fornecedor?: string
  pdv?: string
}

/**
 * Resolve TODOS os codigo_produto que batem o filtro (nao so uma pagina) --
 * usado pelo modo de selecao "todos que batem o filtro atual" das rotas de
 * impressao. Espelha exatamente a logica de filtro de app/(app)/produto/page.tsx.
 */
export async function resolverCodigosPorFiltro(
  lojaId: number,
  filtro: FiltroProdutosSelecao,
): Promise<number[]> {
  const supabase = await createClient()

  let restricaoCods: number[] | null = null
  if (filtro.fornecedor) {
    const { data } = await supabase.rpc('compras_produtos_do_fornecedor', {
      p_loja_id: lojaId,
      p_fornecedor: filtro.fornecedor,
    })
    restricaoCods = ((data ?? []) as { cod: number }[]).map((r) => Number(r.cod))
  }

  const linhas = await buscarTudoPaginado<{ codigo_produto: number | null }>((from, to) => {
    let query = supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', lojaId)
      .range(from, to)

    if (filtro.q) {
      const q = escapeIlikeOr(filtro.q)
      query = query.or(`descricao.ilike.%${q}%,codigo.ilike.%${q}%,ean.ilike.%${q}%`)
    }
    if (filtro.familia) query = query.eq('descricao_familia', filtro.familia)
    if (filtro.tipo) query = query.eq('tipo_item', filtro.tipo)
    if (filtro.pdv === 'sim') query = query.eq('pdv', true)
    else if (filtro.pdv === 'nao') query = query.eq('pdv', false)
    if (!filtro.situacao || filtro.situacao === 'ativos') query = query.eq('inativo', false)
    else if (filtro.situacao === 'inativos') query = query.eq('inativo', true)
    if (restricaoCods !== null) {
      query = query.in('codigo_produto', restricaoCods.length ? restricaoCods : [-1])
    }

    return query
  })

  return [...new Set(linhas.map((l) => l.codigo_produto).filter((c): c is number => c != null))]
}

const TAMANHO_LOTE_IN = 200

export interface ProdutoBasico {
  codigo_produto: number
  codigo: string | null
  descricao: string | null
}

/**
 * Busca produtos por uma lista de codigo_produto, em lotes -- uma unica
 * query .in() com milhares de valores estoura o limite de tamanho de URL
 * do PostgREST (falha silenciosa, a rota trata como "nao encontrado").
 * Usar sempre que a lista de codigos puder vir de resolverCodigosPorFiltro
 * (potencialmente milhares de itens), nao so de uma selecao manual pequena.
 */
export async function buscarProdutosPorCodigos(
  lojaId: number,
  codigos: number[],
): Promise<ProdutoBasico[]> {
  const supabase = await createClient()
  const resultado: ProdutoBasico[] = []
  for (let i = 0; i < codigos.length; i += TAMANHO_LOTE_IN) {
    const lote = codigos.slice(i, i + TAMANHO_LOTE_IN)
    const { data } = await supabase
      .from('produtos')
      .select('codigo_produto, codigo, descricao')
      .eq('loja_id', lojaId)
      .in('codigo_produto', lote)
    resultado.push(...((data ?? []) as ProdutoBasico[]))
  }
  return resultado
}
