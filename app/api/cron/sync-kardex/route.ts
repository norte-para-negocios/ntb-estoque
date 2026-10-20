import { NextResponse } from 'next/server'
import { assertCronAuth, getLojasEspelhoCompleto } from '@/lib/omie/sync-all'
import { sincronizarKardexLoja } from '@/lib/omie/kardex-loja'
import { rodarLojasEspelho } from '@/lib/omie/espelho-ciclo'
import { janelaProibida } from '@/lib/estoque/espelho-lojas'

export const maxDuration = 300

/** Tempo do ciclo para todas as lojas juntas (scripts/sync-espelho.sh espera até 280 s). */
const ORCAMENTO_MS = 200_000

// Kardex da loja inteira (espelho completo, migration 160): só lojas com espelho_completo, uma de cada vez, em rodízio,
// com guarda por loja (bloqueio, disjuntor, erros seguidos: lib/omie/espelho-ciclo.ts) e orçamento de tempo do ciclo.
// Nunca entre 00:00 e 07:00 da Bahia (a faxina do Mac usa a mesma chave do Omie de madrugada).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (janelaProibida(new Date())) return NextResponse.json({ ok: true, pulado: 'janela 00:00-07:00' })
  const lojas = await getLojasEspelhoCompleto()
  const r = await rodarLojasEspelho(lojas, 'kardex', ORCAMENTO_MS, (loja, prazoMs) => sincronizarKardexLoja(loja, { prazoMs }))
  const falhas = r.filter((x) => x.erro)
  const status = lojas.length && falhas.length === lojas.length ? 502 : 200
  return NextResponse.json({ ok: falhas.length === 0, total: lojas.length, lojas: r }, { status })
}
