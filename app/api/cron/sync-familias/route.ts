import { NextResponse } from 'next/server'
import { syncFamilias } from '@/lib/omie/familia'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'
import { corpoDoCron, resultadosDeSettled, statusDoCron } from '@/lib/cron/resposta-puro'

export const maxDuration = 300

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const lojas = await getLojasAtivas()
  const results = await Promise.allSettled(lojas.map((loja) => syncFamilias(loja)))
  const resultados = resultadosDeSettled(lojas, results)
  return NextResponse.json(corpoDoCron(resultados), { status: statusDoCron(resultados) })
}
