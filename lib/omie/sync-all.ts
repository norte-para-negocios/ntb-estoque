import { createServiceClient } from '@/lib/supabase/server'
import type { LojaOmie } from './client'
import { lojaPodeEspelhar, type LojaCandidata } from '@/lib/estoque/espelho-lojas'
import { cronAutorizado } from '@/lib/seguranca/regras'
import { lojasDoFinanceiro } from '@/lib/financeiro-omie/lojas'

export async function getLojasAtivas(): Promise<LojaOmie[]> {
  const supabase = createServiceClient({ semAutor: true })
  const { data } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('ativo', true)
    .eq('is_test', false)
    .not('omie_app_key', 'is', null)
  return (data ?? []) as LojaOmie[]
}

// Fase H: sem CRON_SECRET configurado nenhum cron passa (antes "Bearer undefined" passava); comparação em tempo constante.
export function assertCronAuth(request: Request): boolean {
  return cronAutorizado(request.headers.get('authorization'), process.env.CRON_SECRET)
}

/**
 * Lojas dos crons do espelho completo ("nosso Omie", migration 160): só `espelho_completo`, loja real,
 * modo Omie, nunca a loja 4. Sem a coluna (migration não aplicada) devolve [] e loga.
 */
export async function getLojasEspelhoCompleto(): Promise<LojaOmie[]> {
  const { data, error } = await createServiceClient({ semAutor: true })
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test, ativo, espelho_completo, modo_estoque')
    .eq('ativo', true)
    .eq('is_test', false)
    .eq('espelho_completo', true)
    .neq('id', 4)
    .not('omie_app_key', 'is', null)
    .order('id')
  if (error) {
    console.error(`[espelho] lojas com espelho_completo: ${error.message}`)
    return []
  }
  return ((data ?? []) as (LojaOmie & LojaCandidata)[])
    .filter(lojaPodeEspelhar)
    .map(({ id, omie_app_key, omie_app_secret, is_test }) => ({ id, omie_app_key, omie_app_secret, is_test }))
}

/**
 * Lojas que consultam a OP a cada aviso do webhook e entram no cron de OPs fantasmas (`lojas.omie_op_tempo_real`,
 * migration 250, padrão false = o comportamento de 16/10 a 20/10 em todas as lojas). Sem a coluna ou com erro: nenhuma
 * (na dúvida, não consulta o Omie).
 */
export async function lojasOpTempoReal(): Promise<Set<number>> {
  const { data, error } = await createServiceClient({ semAutor: true }).from('lojas').select('id').eq('omie_op_tempo_real', true)
  if (error) {
    console.error(`[omie_op_tempo_real] ${error.message}`)
    return new Set()
  }
  return new Set((data ?? []).map((l) => Number(l.id)))
}

export async function lojaOpTempoReal(lojaId: number): Promise<boolean> {
  const { data, error } = await createServiceClient({ semAutor: true }).from('lojas').select('omie_op_tempo_real').eq('id', lojaId).maybeSingle()
  if (error) {
    console.error(`[omie_op_tempo_real] loja ${lojaId}: ${error.message}`)
    return false
  }
  return (data as { omie_op_tempo_real?: boolean | null } | null)?.omie_op_tempo_real === true
}

/**
 * Lojas do espelho do financeiro do Omie (Financeiro A0): regra própria `lojaPodeEspelharFinanceiro` (loja real, ativa,
 * modo Omie, com chave, nunca a 4; não exige espelho_completo), filtradas por OMIE_FIN_LOJAS (opcional) e, na API, sem
 * OMIE_FIN_API_FORA (padrão 7). Erro ao ler as lojas LANÇA (o cron não roda em vez de pular avisos).
 */
export async function getLojasFinanceiroOmie(): Promise<{ avisos: LojaOmie[]; api: LojaOmie[] }> {
  const { data, error } = await createServiceClient({ semAutor: true })
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test, ativo, modo_estoque')
    .eq('ativo', true)
    .eq('is_test', false)
    .neq('id', 4)
    .not('omie_app_key', 'is', null)
    .order('id')
  if (error) throw new Error(`lojas (financeiro): ${error.message}`)
  const r = lojasDoFinanceiro((data ?? []) as (LojaOmie & LojaCandidata)[], {
    OMIE_FIN_LOJAS: process.env.OMIE_FIN_LOJAS, OMIE_FIN_API_FORA: process.env.OMIE_FIN_API_FORA,
  })
  const so = ({ id, omie_app_key, omie_app_secret, is_test }: LojaOmie) => ({ id, omie_app_key, omie_app_secret, is_test })
  return { avisos: r.avisos.map(so), api: r.api.map(so) }
}
