// Barra de pesquisa da lista de OPs (?q=): número da OP, código do Omie, produto, cupom/observação ou data (dd/mm).
// Usada pela tela e pela exportação, para as duas mostrarem as mesmas OPs.
import type { SupabaseClient } from '@supabase/supabase-js'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { clausulasBuscaOP, interpretarBuscaOP } from '@/lib/movimentacoes/movimentacoes-puro'

const MAX_PRODUTOS = 300

export type BuscaOP = { ativa: boolean; or: string | null; data: string | null }

/** Resolve a busca (produtos casados viram até 300 códigos) e devolve o filtro pronto para `.or()`. */
export async function resolverBuscaOP(supabase: SupabaseClient, lojaId: number, q: string | undefined, hoje: string): Promise<BuscaOP> {
  const t = (q ?? '').trim()
  if (!t) return { ativa: false, or: null, data: null }
  const b = interpretarBuscaOP(t, hoje)
  if (b.data) return { ativa: true, or: `identificacao_d_dt_previsao.eq.${b.data},dt_conclusao_real.eq.${b.data}`, data: b.data }
  const texto = escapeIlikeOr(b.texto)
  const { data } = await supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    .or(`descricao.ilike.%${texto}%,codigo.ilike.%${texto}%`).order('id').limit(MAX_PRODUTOS)
  const ids = (data ?? []).map((p) => Number(p.codigo_produto)).filter((x) => Number.isFinite(x))
  return { ativa: true, or: clausulasBuscaOP({ ...b, texto }, ids).join(','), data: null }
}

/** Aplica a busca numa query de ordens_producao (qualquer select). */
export function aplicarBuscaOP<Q extends { or: (f: string) => Q }>(q: Q, b: BuscaOP): Q {
  return b.ativa && b.or ? q.or(b.or) : q
}
