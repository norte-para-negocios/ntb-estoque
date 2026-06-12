import { NextResponse } from 'next/server'
import { syncOrdensProducao } from '@/lib/omie/ordem-producao'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

function dmy(date: Date): string {
  return date.toLocaleDateString('pt-BR')
}

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const lojas = await getLojasAtivas()
  // Janela: ultimos 7 dias ate +2 dias (mesma do Laravel)
  const de = new Date(Date.now() - 7 * 86400000)
  const ate = new Date(Date.now() + 2 * 86400000)
  const results = await Promise.allSettled(
    lojas.map((loja) => syncOrdensProducao(loja, dmy(de), dmy(ate)))
  )
  const ok = results.filter((r) => r.status === 'fulfilled').length
  return NextResponse.json({ total: lojas.length, ok, falhas: lojas.length - ok })
}
