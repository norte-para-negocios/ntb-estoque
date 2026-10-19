import { createServiceClient } from '@/lib/supabase/server'
import type { LojaOmie } from './client'
import { lojaPodeEspelhar, type LojaCandidata } from '@/lib/estoque/espelho-lojas'
import { cronAutorizado } from '@/lib/seguranca/regras'

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
