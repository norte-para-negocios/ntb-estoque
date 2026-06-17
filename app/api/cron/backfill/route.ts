import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { syncOrdensProducao } from '@/lib/omie/ordem-producao'
import { syncNotasFiscais } from '@/lib/omie/nota-fiscal'
import type { LojaOmie } from '@/lib/omie/client'

export const maxDuration = 300

// Backfill MENSAL de 2026 (o Omie trunca periodos longos -> mes a mes vem completo).
// Reusa as funcoes de sync (mapeamento ja testado). Uso pontual:
//   GET /api/cron/backfill?modelo=op&loja=3   (header Authorization: Bearer <CRON_SECRET>)
//   modelo: 'op' (ordens de producao, por conclusao) | 'nf' (notas fiscais)
const MESES_2026: [string, string][] = [
  ['01/01/2026', '31/01/2026'],
  ['01/02/2026', '28/02/2026'],
  ['01/03/2026', '31/03/2026'],
  ['01/04/2026', '30/04/2026'],
  ['01/05/2026', '31/05/2026'],
  ['01/06/2026', '30/06/2026'],
]

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const lojaId = Number(url.searchParams.get('loja'))
  const modelo = url.searchParams.get('modelo') ?? 'op'
  if (!lojaId) return NextResponse.json({ error: 'parametro loja obrigatorio' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return NextResponse.json({ error: 'loja nao encontrada' }, { status: 404 })

  const fn = modelo === 'nf' ? syncNotasFiscais : syncOrdensProducao
  const erros: string[] = []
  for (const [ini, fim] of MESES_2026) {
    try {
      await fn(loja, ini, fim)
    } catch (e) {
      erros.push(`${ini}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return NextResponse.json({ ok: true, loja: lojaId, modelo, meses: MESES_2026.length, erros })
}
