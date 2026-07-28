'use server'

import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { complementarNotasFiscais, complementarOrdensProducao } from '@/lib/historico-contabo'

export type BuscaItem = {
  tipo: 'Produto' | 'Nota' | 'OP'
  label: string
  sub: string
  href: string
}

/**
 * Busca global no escopo da loja atual. Procura em produtos, notas fiscais e
 * ordens de producao em paralelo, com limite de 5 resultados por tipo.
 * Retorna sempre um array (vazio em qualquer erro ou termo curto), nunca quebra.
 */
export async function buscaGlobal(termo: string): Promise<BuscaItem[]> {
  const t = (termo ?? '').trim()
  if (t.length < 2) return []

  // Escopo: loja atual. Sem loja, retorna vazio (sem redirect).
  let lojaId: number | null = null
  try {
    const profile = await getProfile()
    lojaId = profile.current_loja_id
  } catch {
    return []
  }
  if (!lojaId) return []

  const supabase = await createClient()
  const p = `%${escapeIlikeOr(t)}%`

  const buscaProdutos = async (): Promise<BuscaItem[]> => {
    try {
      const { data, error } = await supabase
        .from('produtos')
        .select('id, codigo, descricao')
        .eq('loja_id', lojaId)
        .or(`codigo.ilike.${p},descricao.ilike.${p}`)
        .limit(5)
      if (error || !data) return []
      return data.map((row) => ({
        tipo: 'Produto' as const,
        label: row.descricao || row.codigo || 'Produto',
        sub: row.codigo || '',
        href: `/produto?q=${encodeURIComponent(row.codigo || row.descricao || '')}`,
      }))
    } catch {
      return []
    }
  }

  const buscaNotas = async (): Promise<BuscaItem[]> => {
    try {
      const { data, error } = await supabase
        .from('notas_fiscais')
        .select('id, n_id_receb, c_numero_nfe, c_razao_social, c_nome')
        .eq('loja_id', lojaId)
        .is('deleted_at', null)
        .or(`c_numero_nfe.ilike.${p},c_razao_social.ilike.${p},c_nome.ilike.${p}`)
        .limit(5)
      if (error) return []
      const completas = await complementarNotasFiscais(data ?? [], { lojaId, busca: t })
      return completas.slice(0, 5).map((row) => ({
        tipo: 'Nota' as const,
        label: row.c_razao_social || row.c_nome || 'Fornecedor',
        sub: `NFe ${row.c_numero_nfe ?? '-'}`,
        href: `/nota-fiscal/${row.id}`,
      }))
    } catch {
      return []
    }
  }

  const buscaOrdens = async (): Promise<BuscaItem[]> => {
    try {
      const { data, error } = await supabase
        .from('ordens_producao')
        .select('id, identificacao_n_cod_op, num_ordem, identificacao_c_num_op')
        .eq('loja_id', lojaId)
        .or(`num_ordem.ilike.${p},identificacao_c_num_op.ilike.${p}`)
        .limit(5)
      if (error) return []
      const completas = await complementarOrdensProducao(data ?? [], { lojaId, busca: t })
      return completas.slice(0, 5).map((row) => ({
        tipo: 'OP' as const,
        label: row.num_ordem || row.identificacao_c_num_op || 'Ordem',
        sub: 'OP',
        href: '/ordem-producao',
      }))
    } catch {
      return []
    }
  }

  const [produtos, notas, ordens] = await Promise.all([
    buscaProdutos(),
    buscaNotas(),
    buscaOrdens(),
  ])

  return [...produtos, ...notas, ...ordens]
}
