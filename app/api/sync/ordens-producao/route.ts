import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { syncOrdensProducao } from '@/lib/omie/ordem-producao'
import type { LojaOmie } from '@/lib/omie/client'

export const maxDuration = 300

function dmy(date: Date): string {
  return date.toLocaleDateString('pt-BR')
}

export async function POST() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Sincronizar'))) {
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

  try {
    const de = new Date(Date.now() - 7 * 86400000)
    const ate = new Date(Date.now() + 2 * 86400000)
    await syncOrdensProducao(loja, dmy(de), dmy(ate))
    const { count } = await supabase
      .from('ordens_producao')
      .select('id', { count: 'exact', head: true })
      .eq('loja_id', lojaId)
    return NextResponse.json({ ok: true, registros: count ?? 0 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falha na sincronizacao' },
      { status: 500 }
    )
  }
}
