import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao, getUser } from '@/lib/auth'
import { syncFaturamento } from '@/lib/omie/faturamento'
import type { LojaOmie } from '@/lib/omie/client'

// Botão "Atualizar" do relatório de faturamento: repuxa tipo/família direto dos
// cupons fiscais do Omie pra loja atual. Antes desta rota, o único jeito de
// repuxar via API era rodar scripts/sync-faturamento-api.mjs manualmente (um
// script de dev, sem UI) -- ninguém reexecutava com regularidade, e por isso o
// faturamento "parava" de atualizar mesmo com dados antigos existindo (ver
// também /api/cron/sync-faturamento, que roda esta mesma sync sozinha à noite).
export const maxDuration = 300

export async function POST() {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja?.omie_app_key) {
    return NextResponse.json({ error: 'Loja sem integração Omie' }, { status: 400 })
  }

  try {
    const user = await getUser()
    const registros = await syncFaturamento(loja, { importadoPor: user?.id })
    return NextResponse.json({ ok: true, registros })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falha ao consultar cupons fiscais no Omie' },
      { status: 502 },
    )
  }
}
