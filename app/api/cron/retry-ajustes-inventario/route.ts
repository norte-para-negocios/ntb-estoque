import { NextResponse } from 'next/server'
import { retryAjustesInventarioPendentes } from '@/lib/actions/inventario'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const lojas = await getLojasAtivas()
  const resultados = await retryAjustesInventarioPendentes(lojas, { limitePorLoja: 30 })
  const tentadas = resultados.reduce((acc, r) => acc + r.tentadas, 0)
  const sucesso = resultados.reduce((acc, r) => acc + r.sucesso, 0)
  const falhas = resultados.reduce((acc, r) => acc + r.falhas, 0)
  return NextResponse.json({ lojas: lojas.length, tentadas, sucesso, falhas, resultados })
}
