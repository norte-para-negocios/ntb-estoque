import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  await supabase.from('webhooks').delete().lt('created_at', sevenDaysAgo)
  await supabase.from('integration_attempts').delete().lt('created_at', sevenDaysAgo)
  return NextResponse.json({ ok: true })
}
