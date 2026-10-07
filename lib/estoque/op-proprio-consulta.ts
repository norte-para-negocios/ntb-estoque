import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { escapeIlikeOr } from '@/lib/utils-busca'

// Filtros de pesquisa da lista de OPs que só existem no estoque próprio (a lista e o export usam o mesmo código para a tela e o Excel baterem):
// local de produção, usuário (quem criou ou concluiu) e insumo usado (código ou descrição de qualquer ingrediente da receita).

export type FiltrosOPProprio = { local?: string; usuario?: string; insumo?: string }

export type FiltrosOPResolvidos = { local: number | null; usuario: string | null; idsInsumo: number[] | null }

export async function resolverFiltrosOPProprio(supabase: SupabaseClient, lojaId: number, f: FiltrosOPProprio): Promise<FiltrosOPResolvidos> {
  let idsInsumo: number[] | null = null
  const termo = f.insumo?.trim()
  if (termo) {
    const t = escapeIlikeOr(termo)
    const { data: prods } = await supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).or(`codigo.ilike.%${t}%,descricao.ilike.%${t}%`).limit(500)
    const codigos = [...new Set((prods ?? []).map((p) => Number(p.codigo_produto)).filter((n) => Number.isFinite(n)))]
    if (!codigos.length) idsInsumo = []
    else {
      const { data: ids } = await createServiceClient().rpc('op_proprio_ids_por_insumo', { p_loja: lojaId, p_codigos: codigos })
      idsInsumo = ((ids ?? []) as { id: number }[]).map((r) => Number(r.id))
    }
  }
  return {
    local: f.local && /^\d+$/.test(f.local) ? Number(f.local) : null,
    usuario: f.usuario?.trim() ? f.usuario.trim() : null,
    idsInsumo,
  }
}

/** Aplica os filtros resolvidos a uma query de `ordens_producao`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function aplicarFiltrosOPProprio<Q extends any>(q: Q, r: FiltrosOPResolvidos): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let x: any = q
  if (r.local != null) x = x.eq('identificacao_codigo_local_estoque', r.local)
  if (r.usuario) {
    const t = escapeIlikeOr(r.usuario)
    x = x.or(`criada_por.ilike.%${t}%,concluida_por_nome.ilike.%${t}%`)
  }
  if (r.idsInsumo !== null) x = x.in('id', r.idsInsumo.length ? r.idsInsumo : [-1])
  return x as Q
}

export type ExtraOPProprio = {
  id: number
  local_destino: number | null
  criada_por: string | null
  concluida_por_nome: string | null
  custo_total: number | null
  custo_unitario: number | null
  ficha_versao: number | null
  identificacao_codigo_local_estoque: number | null
  dt_conclusao_real: string | null
  identificacao_d_dt_previsao: string | null
  venda_ref: string | null
}

/** Colunas extras do estoque próprio para um conjunto de OPs (lotes pequenos: URL curta). */
export async function carregarExtrasOPProprio(supabase: SupabaseClient, lojaId: number, ids: number[]): Promise<Map<number, ExtraOPProprio>> {
  const mapa = new Map<number, ExtraOPProprio>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('ordens_producao')
      .select('id, local_destino, criada_por, concluida_por_nome, custo_total, custo_unitario, ficha_versao, identificacao_codigo_local_estoque, dt_conclusao_real, identificacao_d_dt_previsao, venda_ref')
      .eq('loja_id', lojaId).in('id', ids.slice(i, i + 200))
    for (const r of (data ?? []) as ExtraOPProprio[]) mapa.set(Number(r.id), r)
  }
  return mapa
}
