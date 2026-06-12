import { NextResponse } from 'next/server'
import { syncProdutos } from '@/lib/omie/produto'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const lojas = await getLojasAtivas()
  const results = await Promise.allSettled(lojas.map((loja) => syncProdutos(loja)))
  const ok = results.filter((r) => r.status === 'fulfilled').length
  return NextResponse.json({ total: lojas.length, ok, falhas: lojas.length - ok })
}
