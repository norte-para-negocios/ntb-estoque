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

export type LinhaSaldoDataRow = { n_cod_prod: number; codigo_local_estoque: number; saldo: number | null; cmc: number | null; data_mov: string }

/** Saldo e custo de cada produto/local numa data, pelo kardex do Omie (RPC saldo_em_data, migration 160). */
export async function carregarSaldoEmData(lojaId: number, data: string): Promise<{ rows: LinhaSaldoDataRow[]; erro: string | null }> {
  const supabase = await createClient()
  let erro: string | null = null
  const rows = await buscarTodasLinhas<LinhaSaldoDataRow>((from, to) =>
    supabase.rpc('saldo_em_data', { p_loja_id: lojaId, p_data: data })
      .select('n_cod_prod, codigo_local_estoque, saldo, cmc, data_mov')
      .order('n_cod_prod').order('codigo_local_estoque').range(from, to) as unknown as PromiseLike<{ data: LinhaSaldoDataRow[] | null; error: { message: string } | null }>,
    undefined, (e) => { erro = e.message })
  return { rows, erro }
}

export type MovPosteriorRow = { n_cod_prod: number; codigo_local_estoque: number; quantidade: number; saldo_apos: number | null; cmc_apos: number | null; data_mov: string }

/** 1º movimento depois da data por produto/local (RPC primeiro_mov_apos, migration 161). */
export async function carregarPrimeiroMovApos(lojaId: number, data: string): Promise<{ rows: MovPosteriorRow[]; erro: string | null }> {
  const supabase = await createClient()
  let erro: string | null = null
  const rows = await buscarTodasLinhas<MovPosteriorRow>((from, to) =>
    supabase.rpc('primeiro_mov_apos', { p_loja_id: lojaId, p_data: data })
      .select('n_cod_prod, codigo_local_estoque, quantidade, saldo_apos, cmc_apos, data_mov')
      .order('n_cod_prod').order('codigo_local_estoque').range(from, to) as unknown as PromiseLike<{ data: MovPosteriorRow[] | null; error: { message: string } | null }>,
    undefined, (e) => { erro = e.message })
  return { rows, erro }
}
