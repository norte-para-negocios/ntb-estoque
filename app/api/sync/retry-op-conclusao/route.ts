import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { retryOPsPendentes } from '@/lib/actions/ordem-producao'
import type { LojaOmie } from '@/lib/omie/client'

export const maxDuration = 300

export async function POST() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Concluir'))) {
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
    // Reenvio manual: sem o throttle de 1h do 'Sem CMC' (usuario clicou agora, ja
    // deve ter corrigido o CMC no Omie se era o caso).
    const [resultado] = await retryOPsPendentes([loja], {
      incluirSemCmc: true,
      limitePorLoja: 50,
      semCmcStaleHoras: 0,
    })
    return NextResponse.json({
      ok: true,
      registros: resultado?.sucesso ?? 0,
      tentadas: resultado?.tentadas ?? 0,
      falhas: resultado?.falhas ?? 0,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falha ao reenviar pendentes' },
      { status: 500 }
    )
  }
}
