import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { montarVisaoOmie, type PosicaoRow, type ProdutoRow, type VisaoEspelho } from '@/lib/estoque/espelho-omie'

export type { VisaoEspelho }

/** Estoque da loja Omie a partir do espelho (posicao_estoques): só as 2 fotos mais recentes existem na tabela. */
export async function carregarEstoqueOmie(lojaId: number): Promise<VisaoEspelho> {
  return (await carregarEstoqueOmieComPosicoes(lojaId)).visao
}

/** Igual a carregarEstoqueOmie, devolvendo também as linhas cruas da posição (custo por local na Saúde do estoque). */
export async function carregarEstoqueOmieComPosicoes(lojaId: number): Promise<{ visao: VisaoEspelho; posicoes: PosicaoRow[] }> {
  const supabase = await createClient()
  const [produtos, posicoes, locaisRes, famRes] = await Promise.all([
    buscarTodasLinhas<ProdutoRow>((from, to) =>
      supabase.from('produtos')
        .select('codigo_produto, codigo, descricao, unidade, tipo_item, codigo_familia, estoque_minimo')
        .eq('loja_id', lojaId).neq('inativo', true).order('id').range(from, to)),
    buscarTodasLinhas<PosicaoRow>((from, to) =>
      supabase.from('posicao_estoques')
        .select('data_posicao, codigo_local_estoque, n_cod_prod, n_saldo, n_cmc, estoque_minimo, updated_at')
        .eq('loja_id', lojaId).order('id').range(from, to)),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao, inativo').eq('loja_id', lojaId).order('descricao'),
    supabase.from('familias').select('codigo_familia, nome').eq('loja_id', lojaId).order('nome'),
  ])
  const visao = montarVisaoOmie({ produtos, posicoes, locais: locaisRes.data ?? [], familias: famRes.data ?? [] })
  return { visao, posicoes }
}
