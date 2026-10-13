import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { syncPosicaoEstoque } from '@/lib/omie/posicao-estoque'
import type { LojaOmie } from '@/lib/omie/client'
import { pegarTravaSync, soltarTravaSync } from '@/lib/omie/trava-sync'

const INTERVALO_MIN_MS = 5 * 60_000

export const maxDuration = 300

export async function POST() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos - Sincronizar'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }
  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja?.omie_app_key) {
    return NextResponse.json({ error: 'Loja sem integracao Omie' }, { status: 400 })
  }
  // Recusa se a posicao foi atualizada ha menos de 5 min (botao repetido / varios usuarios).
  const { data: ultima } = await supabase.from('posicao_estoques').select('updated_at')
    .eq('loja_id', lojaId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (ultima?.updated_at && Date.now() - new Date(ultima.updated_at as string).getTime() < INTERVALO_MIN_MS) {
    return NextResponse.json({ error: 'Atualizado ha poucos minutos. Tente de novo daqui a pouco.' }, { status: 429 })
  }
  // Trava compartilhada com o cron sync-posicao: nunca dois syncs da mesma loja ao mesmo tempo.
  if (!(await pegarTravaSync(lojaId, 'posicao', 600))) {
    return NextResponse.json({ error: 'Ja tem uma atualizacao em andamento. Aguarde alguns minutos.' }, { status: 429 })
  }
  try {
    const registros = await syncPosicaoEstoque(loja)
    return NextResponse.json({ ok: true, registros })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falha na sincronizacao' },
      { status: 500 }
    )
  } finally {
    await soltarTravaSync(lojaId, 'posicao')
  }
}
