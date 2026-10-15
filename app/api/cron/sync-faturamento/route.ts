import { NextResponse } from 'next/server'
import { syncFaturamento } from '@/lib/omie/faturamento'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

// Sincronização noturna do faturamento (tipo/família) para todas as lojas com
// integração Omie. Antes desta rota não existia NENHUM cron pra isso -- a única
// forma de repuxar via API era rodar scripts/sync-faturamento-api.mjs à mão, o
// que raramente acontecia (raiz do "faturamento parou de atualizar" reportado
// pelo Ramon em 06/07). Ver também /api/sync/faturamento (botão "Atualizar" manual).
export const maxDuration = 300

// Só mês atual + anterior: o ano inteiro de hora em hora estourava o tempo (15/10/2026). Ano inteiro = botão manual.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const lojas = await getLojasAtivas()
  const results = await Promise.allSettled(lojas.map((loja) => syncFaturamento(loja, { meses: 2 })))
  const ok = results.filter((r) => r.status === 'fulfilled').length
  return NextResponse.json({ total: lojas.length, ok, falhas: lojas.length - ok })
}
