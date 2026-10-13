// Leituras compartilhadas pelas telas de informação/auditoria do estoque ("nosso Omie" Fases 2 e 3).
import { createClient } from '@/lib/supabase/server'
import { historicoDesde, lerEstado } from '@/lib/estoque/espelho-frentes'

/** Flag do espelho completo da loja (migration 160). Sem a coluna, false. `lojas` sempre com is_test no select. */
export async function lojaEspelho(lojaId: number): Promise<{ isTest: boolean; espelhoCompleto: boolean }> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('lojas').select('id, is_test, espelho_completo').eq('id', lojaId).maybeSingle()
  if (error || !data) {
    const { data: d2 } = await supabase.from('lojas').select('id, is_test').eq('id', lojaId).maybeSingle()
    return { isTest: !!d2?.is_test, espelhoCompleto: false }
  }
  return { isTest: !!data.is_test, espelhoCompleto: data.espelho_completo === true }
}

/** Desde quando o kardex do Omie da loja está completo (cursor do cron sync-kardex). null = ainda sem histórico. */
export async function historicoKardexDesde(lojaId: number): Promise<{ desde: string | null; ativo: boolean }> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('espelho_sync_estado').select('estado').eq('loja_id', lojaId).eq('frente', 'kardex').maybeSingle()
  if (error) return { desde: null, ativo: false }
  return { desde: data ? historicoDesde(lerEstado(data.estado)) : null, ativo: !!data }
}

/** Roda `fn` em lotes (URL curta: ver "414 URI Too Long" no AGENTS.md) e junta os resultados. */
export async function emLotes<T, R>(ids: T[], tamanho: number, fn: (lote: T[]) => Promise<R[]>): Promise<R[]> {
  const r: R[] = []
  for (let i = 0; i < ids.length; i += tamanho) r.push(...(await fn(ids.slice(i, i + tamanho))))
  return r
}

/** Nomes de pessoas (profiles) para ids uuid gravados no ledger próprio; textos que não são uuid voltam iguais. */
export async function nomesDeUsuarios(ids: (string | null)[]): Promise<Map<string, string>> {
  const uuids = [...new Set(ids.filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))]
  const m = new Map<string, string>()
  if (!uuids.length) return m
  const supabase = await createClient()
  const rows = await emLotes(uuids, 100, async (lote) => {
    const { data } = await supabase.from('profiles').select('id, name').in('id', lote)
    return (data ?? []) as { id: string; name: string | null }[]
  })
  for (const p of rows) if (p.name) m.set(p.id, p.name)
  return m
}

export const fmtDataBR = (iso: string | null | undefined) => {
  if (!iso) return '-'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}
