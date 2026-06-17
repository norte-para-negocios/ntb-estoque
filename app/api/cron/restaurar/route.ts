import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { TABELAS_ARQUIVAVEIS, restaurarPeriodo, type TabelaArquivavel } from '@/lib/arquivo-morto'

export const maxDuration = 300

// Restore sob demanda: baixa o .json.gz do Storage e re-insere o período na própria
// tabela (upsert idempotente), tornando-o consultável pelas telas normais. Uso:
//   GET /api/cron/restaurar?tabela=ordens_producao&periodo=2025-01
//   header Authorization: Bearer <CRON_SECRET>
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const tabela = url.searchParams.get('tabela') as TabelaArquivavel | null
  const periodo = url.searchParams.get('periodo')
  if (!tabela || !(tabela in TABELAS_ARQUIVAVEIS)) {
    return NextResponse.json({ error: 'parametro tabela invalido' }, { status: 400 })
  }
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
    return NextResponse.json({ error: 'parametro periodo invalido (AAAA-MM)' }, { status: 400 })
  }

  const supabase = createServiceClient()
  try {
    const r = await restaurarPeriodo(supabase, tabela, periodo)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
