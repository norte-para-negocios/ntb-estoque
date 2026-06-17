import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const seteDias = new Date(Date.now() - 7 * 86400000).toISOString()
  const doisDias = new Date(Date.now() - 2 * 86400000).toISOString()
  const trintaDias = new Date(Date.now() - 30 * 86400000).toISOString()

  await supabase.from('webhooks').delete().lt('created_at', seteDias)
  // Logs de integracao crescem ~16 mil/dia. Os de SUCESSO (a grande maioria) so
  // servem por pouco tempo -> apaga > 2 dias. Os ERROS (poucos, uteis p/ debug)
  // ficam ate 30 dias. Mantem a tabela pequena sem perder o que importa.
  await supabase.from('integration_attempts').delete().eq('error', false).lt('created_at', doisDias)
  await supabase.from('integration_attempts').delete().is('error', null).lt('created_at', doisDias)
  await supabase.from('integration_attempts').delete().lt('created_at', trintaDias)
  return NextResponse.json({ ok: true })
}
