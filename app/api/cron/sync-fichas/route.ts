import { NextResponse } from 'next/server'
import { assertCronAuth, getLojasEspelhoCompleto } from '@/lib/omie/sync-all'
import { sincronizarFichasLoja } from '@/lib/omie/fichas'
import { rodarLojasEspelho } from '@/lib/omie/espelho-ciclo'
import { janelaProibida } from '@/lib/estoque/espelho-lojas'

export const maxDuration = 300

const ORCAMENTO_MS = 120_000

// Fichas técnicas automáticas (espelho completo, migration 160): até 20 produtos PA/PI por loja e ciclo, refaz a cada
// 7 dias. Lojas com espelho_completo, uma de cada vez, em rodízio, com guarda e orçamento (lib/omie/espelho-ciclo.ts);
// nunca entre 00:00 e 07:00 da Bahia.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (janelaProibida(new Date())) return NextResponse.json({ ok: true, pulado: 'janela 00:00-07:00' })
  const lojas = await getLojasEspelhoCompleto()
  const r = await rodarLojasEspelho(lojas, 'fichas', ORCAMENTO_MS, (loja, prazoMs) => sincronizarFichasLoja(loja, { prazoMs }))
  const falhas = r.filter((x) => x.erro)
  const status = lojas.length && falhas.length === lojas.length ? 502 : 200
  return NextResponse.json({ ok: falhas.length === 0, total: lojas.length, lojas: r }, { status })
}
