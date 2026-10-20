import { NextResponse } from 'next/server'
import { relerNotasComAvisoPendente, syncNotasFiscais } from '@/lib/omie/nota-fiscal'
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
    lojas.map(async (loja) => {
      await syncNotasFiscais(loja, dmy(de), dmy(new Date()))
      // Paridade 20/10/2026 (B7): relê até 3 notas re-concluídas/revertidas no Omie desde a última gravação (aviso mais
      // novo que a nota). Fora as lojas 4 e 7; nunca derruba o sync da loja.
      const r = await relerNotasComAvisoPendente(loja).catch((e) => ({ relidas: 0, erro: String(e) }))
      if (r.erro) console.error(`[sync-nfs] releitura loja ${loja.id}: ${r.erro}`)
      return r.relidas
    })
  )
  const ok = results.filter((r) => r.status === 'fulfilled').length
  const relidas = results.reduce((s, r) => s + (r.status === 'fulfilled' ? r.value : 0), 0)
  return NextResponse.json({ total: lojas.length, ok, falhas: lojas.length - ok, relidas })
}
