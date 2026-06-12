import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { syncProdutos } from '@/lib/omie/produto'
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
    await syncProdutos(loja)
    const { count } = await supabase
      .from('produtos')
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
