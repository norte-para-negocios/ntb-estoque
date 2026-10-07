import { createServiceClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Ficha, ItemFicha } from './receita'

export type ResultadoProducao = {
  ok: boolean
  duplicado: boolean
  ordem_id: number
  custo_total: number
  custo_unitario: number
  saldo_produto?: number
  cmc_produto?: number
}

export type ResultadoConsumo = {
  ok: boolean
  tem_receita: boolean
  ficha_id?: number
  versao?: number
  negativo?: boolean
  itens?: { insumo: number; quantidade: number; saldo: number; duplicado: boolean }[]
}

type FichaRow = { id: number; codigo_produto: number; versao: number; rendimento: number; expandir_na_venda: boolean; ativa: boolean; obs: string | null; created_at: string }
type ItemRow = { ficha_id: number; codigo_insumo: number; quantidade_liquida: number; fator_correcao: number; perda_pct: number; ordem: number }

/** Fichas ATIVAS da loja (com itens) como mapa por produto, no formato das regras puras. */
export async function carregarFichasAtivas(supabase: SupabaseClient, lojaId: number): Promise<Map<number, Ficha & { fichaId: number; versao: number }>> {
  const { data: fichas, error } = await supabase
    .from('fichas_tecnicas').select('id, codigo_produto, versao, rendimento, expandir_na_venda, ativa, obs, created_at')
    .eq('loja_id', lojaId).eq('ativa', true).order('id').limit(5000)
  if (error) throw new Error(error.message)
  const lista = (fichas ?? []) as FichaRow[]
  const mapa = new Map<number, Ficha & { fichaId: number; versao: number }>()
  if (!lista.length) return mapa
  const ids = lista.map((f) => f.id)
  const itens: ItemRow[] = []
  // lotes de 200 ids por consulta (URL curta, ver "414 URI Too Long" no AGENTS.md)
  for (let n = 0; n < ids.length; n += 200) {
    const { data, error: e2 } = await supabase
      .from('ficha_tecnica_itens').select('ficha_id, codigo_insumo, quantidade_liquida, fator_correcao, perda_pct, ordem')
      .in('ficha_id', ids.slice(n, n + 200)).order('ficha_id').order('ordem').limit(20000)
    if (e2) throw new Error(e2.message)
    itens.push(...((data ?? []) as ItemRow[]))
  }
  for (const f of lista) {
    mapa.set(Number(f.codigo_produto), {
      fichaId: f.id, versao: f.versao, codigoProduto: Number(f.codigo_produto), rendimento: Number(f.rendimento), expandirNaVenda: f.expandir_na_venda,
      itens: itens.filter((i) => i.ficha_id === f.id).map<ItemFicha>((i) => ({
        codigoInsumo: Number(i.codigo_insumo), quantidadeLiquida: Number(i.quantidade_liquida), fatorCorrecao: Number(i.fator_correcao), perdaPct: Number(i.perda_pct),
      })),
    })
  }
  return mapa
}

export async function salvarFicha(b: {
  lojaId: number; produto: number; rendimento: number; itens: ItemFicha[]; expandirNaVenda?: boolean; user?: string | null; obs?: string | null
}): Promise<{ ficha_id: number; versao: number }> {
  const { data, error } = await createServiceClient().rpc('salvar_ficha', {
    p_loja: b.lojaId, p_produto: b.produto, p_rendimento: b.rendimento,
    p_itens: b.itens.map((i) => ({ codigo_insumo: i.codigoInsumo, quantidade_liquida: i.quantidadeLiquida, fator_correcao: i.fatorCorrecao, perda_pct: i.perdaPct })),
    p_expandir_na_venda: b.expandirNaVenda ?? false, p_user: b.user ?? null, p_obs: b.obs ?? null,
  })
  if (error) throw new Error(error.message)
  return data as { ficha_id: number; versao: number }
}

export async function desativarFicha(lojaId: number, produto: number): Promise<void> {
  const { error } = await createServiceClient().rpc('desativar_ficha', { p_loja: lojaId, p_produto: produto })
  if (error) throw new Error(error.message)
}

export async function produzirLote(b: {
  lojaId: number; produto: number; quantidade: number; localConsumo: number; localDestino: number; ref: string; user?: string | null; obs?: string | null
}): Promise<ResultadoProducao> {
  const { data, error } = await createServiceClient().rpc('produzir', {
    p_loja: b.lojaId, p_produto: b.produto, p_quantidade: b.quantidade, p_local_consumo: b.localConsumo, p_local_destino: b.localDestino,
    p_ref: b.ref, p_user: b.user ?? null, p_obs: b.obs ?? null,
  })
  if (error) throw new Error(error.message)
  return data as ResultadoProducao
}

/** Venda de produto com ficha ativa: baixa os insumos (e sub-receitas expandidas) no local. `tem_receita:false` = nada gravado. */
export async function consumoPorReceita(
  supabase: SupabaseClient,
  b: { lojaId: number; produto: number; quantidade: number; local: number; ref: string; linhaBase: number; user?: string | null }
): Promise<ResultadoConsumo> {
  const { data, error } = await supabase.rpc('consumo_por_receita', {
    p_loja: b.lojaId, p_produto: b.produto, p_quantidade: b.quantidade, p_local: b.local, p_ref: b.ref,
    p_user: b.user ?? null, p_linha_base: b.linhaBase, p_origem: 'VENDA',
  })
  if (error) throw new Error(error.message)
  return data as ResultadoConsumo
}
