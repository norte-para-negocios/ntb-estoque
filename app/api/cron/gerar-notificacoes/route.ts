import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { gerarNotificacoes } from '@/lib/notificacoes/coletar'

export const maxDuration = 300

// Fase G (migration 222): gera as notificações do sininho para todas as lojas ativas. Só lê o banco (nenhuma chamada ao
// Omie, nada é enviado para fora). Agendado no scripts/sync-cron.sh (blocos 1 e 4 = 2x por hora). 502 só se TODAS falharem.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const r = await gerarNotificacoes()
    const falhas = r.filter((x) => !x.ok)
    for (const f of falhas) console.error(`gerar-notificacoes: loja ${f.loja}: ${f.erro}`)
    const todasFalharam = r.length > 0 && falhas.length === r.length
    return NextResponse.json(
      { total: r.length, ok: r.length - falhas.length, falhas: falhas.length, ativas: r.reduce((a, x) => a + x.ativas, 0) },
      { status: todasFalharam ? 502 : 200 },
    )
  } catch (e) {
    console.error('gerar-notificacoes:', e)
    return NextResponse.json({ error: 'falha ao gerar notificações' }, { status: 502 })
  }
}
