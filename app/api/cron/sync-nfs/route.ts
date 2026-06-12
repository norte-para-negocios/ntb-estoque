import { NextResponse } from 'next/server'
import { syncNotasFiscais } from '@/lib/omie/nota-fiscal'
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
  // Janela: ultimos 7 dias (mesma do Laravel)
  const de = new Date(Date.now() - 7 * 86400000)
  const results = await Promise.allSettled(
    lojas.map((loja) => syncNotasFiscais(loja, dmy(de), dmy(new Date())))
  )
  const ok = results.filter((r) => r.status === 'fulfilled').length
  return NextResponse.json({ total: lojas.length, ok, falhas: lojas.length - ok })
}
