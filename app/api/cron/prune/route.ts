import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { cursoresAvisos } from '@/lib/financeiro-omie/avisos'

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const seteDias = new Date(Date.now() - 7 * 86400000).toISOString()
  const doisDias = new Date(Date.now() - 2 * 86400000).toISOString()
  const trintaDias = new Date(Date.now() - 30 * 86400000).toISOString()

  // Financeiro A0 (27/10/2026): aviso Financas.* só sai depois de processado pelo cron sync-financeiro-avisos
  // (webhooks.id <= cursor da loja em espelho_sync_estado 'fin-avisos'). Cursor ilegível = nenhum financeiro apagado.
  // Os demais avisos seguem a regra de sempre (7 dias). Obs.: esta rota só está no vercel.json (inativo); o crontab do
  // Contabo não a chama hoje, então nada é podado em produção.
  await supabase.from('webhooks').delete().lt('created_at', seteDias).not('message->>topic', 'like', 'Financas.%')
  try {
    for (const [loja, ultimo] of await cursoresAvisos()) {
      if (ultimo > 0) await supabase.from('webhooks').delete().eq('loja_id', loja).lte('id', ultimo).lt('created_at', seteDias)
    }
  } catch (e) {
    console.error('[prune] cursores dos avisos financeiros ilegíveis; avisos financeiros mantidos:', e)
  }
  // Logs de integracao crescem ~16 mil/dia. Os de SUCESSO (a grande maioria) so
  // servem por pouco tempo -> apaga > 2 dias. Os ERROS (poucos, uteis p/ debug)
  // ficam ate 30 dias. Mantem a tabela pequena sem perder o que importa.
  await supabase.from('integration_attempts').delete().eq('error', false).lt('created_at', doisDias)
  await supabase.from('integration_attempts').delete().is('error', null).lt('created_at', doisDias)
  await supabase.from('integration_attempts').delete().lt('created_at', trintaDias)
  return NextResponse.json({ ok: true })
}
