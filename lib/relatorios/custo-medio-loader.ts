import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { custoMedioAtual } from '@/lib/relatorios/cmv-puro'

type Foto = { n_cod_prod: number; codigo_local_estoque: number; n_saldo: number; n_cmc: number }

/**
 * Custo médio e saldo de hoje por produto, da foto mais recente com local real de posicao_estoques (lojas Omie = sync;
 * própria = projeção do ledger). Custo = custoMedioAtual (ponderado pelos locais com saldo; senão a sentinela).
 */
export async function carregarCustoESaldo(lojaId: number, onErro: (onde: string) => void): Promise<{ custo: Map<number, number>; saldo: Map<number, number>; dataFoto: string | null }> {
  const supabase = await createClient()
  const anotar = (onde: string) => (e: { message: string }) => { onErro(onde); console.error(`custo-medio: ${onde}`, e.message) }
  const { data: ult, error } = await supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).neq('codigo_local_estoque', 0)
    .order('data_posicao', { ascending: false }).limit(1).maybeSingle()
  if (error) anotar('data da foto do estoque')(error)
  const dataFoto = ult?.data_posicao ? String(ult.data_posicao) : null
  const foto = dataFoto
    ? await buscarTodasLinhas<Foto>((from, to) => supabase.from('posicao_estoques').select('n_cod_prod, codigo_local_estoque, n_saldo, n_cmc')
        .eq('loja_id', lojaId).eq('data_posicao', dataFoto).order('id').range(from, to), undefined, anotar('posição de estoque'))
    : []
  const saldo = new Map<number, number>()
  for (const f of foto) {
    if (Number(f.codigo_local_estoque) === 0) continue
    const c = Number(f.n_cod_prod)
    saldo.set(c, Math.round(((saldo.get(c) ?? 0) + (Number(f.n_saldo) || 0)) * 1e6) / 1e6)
  }
  return { custo: custoMedioAtual(foto), saldo, dataFoto }
}
