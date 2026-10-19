import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

/** Retenção do histórico de alterações (Fase G, migration 220, revisão I2). */
const RETENCAO_HISTORICO_DIAS = 400
const LOTE = 5000
const MAX_LOTES = 20

// 1x por dia (scripts/sync-cron.sh): apaga em lotes de 5.000 o que passou de 400 dias, no máximo 20 lotes por rodada
// (o resto sai nos dias seguintes). Só o banco; nada do Omie.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createServiceClient()
  let apagadas = 0
  for (let i = 0; i < MAX_LOTES; i++) {
    const { data, error } = await sb.rpc('historico_podar', { p_dias: RETENCAO_HISTORICO_DIAS, p_lote: LOTE })
    if (error) {
      console.error('podar-historico:', error.message)
      return NextResponse.json({ error: 'falha ao podar o histórico', apagadas }, { status: 502 })
    }
    apagadas += Number(data ?? 0)
    if (Number(data ?? 0) < LOTE) break
  }
  return NextResponse.json({ ok: true, apagadas, retencaoDias: RETENCAO_HISTORICO_DIAS })
}
