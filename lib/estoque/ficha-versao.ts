// T5.5 (06/11/2026): versão da ficha por movimento e custo real × teórico da OP (migration 410). Só leitura, só dev na tela.
// As funções da 410 são só do service_role. Sem a migration aplicada (ou com erro), devolve vazio: a tela mostra como antes.
import { createServiceClient } from '@/lib/supabase/server'
import { lerCustoRealTeorico, mapaVersoes, type CustoRealTeorico } from './ficha-versao-puro'

export async function versoesFichaDosMovimentos(lojaId: number, ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map()
  const { data, error } = await createServiceClient().rpc('ficha_versao_dos_movimentos', { p_loja: lojaId, p_ids: ids })
  if (error) { console.error('ficha_versao_dos_movimentos falhou', error.message); return new Map() }
  return mapaVersoes(data as Record<string, unknown>[])
}

/** Custo real × teórico de cada execução (ref "OP:<id>:<n>"). Ref que falhar fica de fora. */
export async function custoRealTeoricoDasExecucoes(lojaId: number, refs: string[]): Promise<Record<string, CustoRealTeorico>> {
  const sb = createServiceClient()
  const out: Record<string, CustoRealTeorico> = {}
  await Promise.all(refs.map(async (ref) => {
    const { data, error } = await sb.rpc('op_custo_real_teorico', { p_loja: lojaId, p_ref: ref })
    if (error) { console.error('op_custo_real_teorico falhou', ref, error.message); return }
    const r = lerCustoRealTeorico(data as Record<string, unknown> | null)
    if (r) out[ref] = r
  }))
  return out
}
