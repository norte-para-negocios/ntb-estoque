import { NextResponse } from 'next/server'
import { syncLocaisEstoque } from '@/lib/omie/local-estoque'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'
import { corpoDoCron, resultadosDeSettled, statusDoCron } from '@/lib/cron/resposta-puro'

export const maxDuration = 300

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const lojas = await getLojasAtivas()
  const results = await Promise.allSettled(lojas.map((loja) => syncLocaisEstoque(loja)))
  const resultados = resultadosDeSettled(lojas, results)
  return NextResponse.json(corpoDoCron(resultados), { status: statusDoCron(resultados) })
}
