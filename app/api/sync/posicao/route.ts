import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { syncPosicaoEstoque } from '@/lib/omie/posicao-estoque'
import type { LojaOmie } from '@/lib/omie/client'

export const maxDuration = 300

export async function POST() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos - Sincronizar'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }
  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja?.omie_app_key) {
    return NextResponse.json({ error: 'Loja sem integracao Omie' }, { status: 400 })
  }
  try {
    const registros = await syncPosicaoEstoque(loja)
    return NextResponse.json({ ok: true, registros })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falha na sincronizacao' },
      { status: 500 }
    )
  }
}
