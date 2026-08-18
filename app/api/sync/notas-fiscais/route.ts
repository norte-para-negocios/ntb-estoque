import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { syncNotasFiscais } from '@/lib/omie/nota-fiscal'
import type { LojaOmie } from '@/lib/omie/client'

export const maxDuration = 300

function dmy(date: Date): string {
  return date.toLocaleDateString('pt-BR')
}

export async function POST() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais - Sincronizar'))) {
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
  // Loja de teste compartilha app_key/app_secret com a loja real (so
  // ESCRITA e simulada, leitura sempre traz dado real -- ver AGENTS.md
  // "Lojas de Teste"). Sincronizar NF manualmente aqui soma trafego real
  // no mesmo app_key, sem ganho nenhum pra loja fake.
  if (loja.is_test) {
    return NextResponse.json(
      { error: 'Sincronizacao manual de notas fiscais nao e permitida em loja de teste (compartilha app_key com a loja real).' },
      { status: 400 }
    )
  }

  try {
    const de = new Date(Date.now() - 7 * 86400000)
    await syncNotasFiscais(loja, dmy(de), dmy(new Date()))
    const { count } = await supabase
      .from('notas_fiscais')
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
