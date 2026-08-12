import { createServiceClient } from '@/lib/supabase/server'
import type { LojaOmie } from './client'

export async function getLojasAtivas(): Promise<LojaOmie[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('ativo', true)
    .eq('is_test', false)
    .not('omie_app_key', 'is', null)
  return (data ?? []) as LojaOmie[]
}

export function assertCronAuth(request: Request): boolean {
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}
