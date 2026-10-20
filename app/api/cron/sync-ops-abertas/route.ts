import { NextResponse } from 'next/server'
import { assertCronAuth, getLojasEspelhoCompleto } from '@/lib/omie/sync-all'
import { sincronizarOpsAbertas } from '@/lib/omie/ops-abertas'
import { rodarLojasEspelho } from '@/lib/omie/espelho-ciclo'
import { janelaProibida } from '@/lib/estoque/espelho-lojas'

export const maxDuration = 300

const ORCAMENTO_MS = 120_000

// Todas as OPs abertas do Omie + ficha gravada na OP (espelho completo, migration 160). Lojas com espelho_completo,
// uma de cada vez, em rodízio, com guarda e orçamento (lib/omie/espelho-ciclo.ts); no máximo 1 leitura completa a cada
// 30 min por loja; nunca entre 00:00 e 07:00 da Bahia.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (janelaProibida(new Date())) return NextResponse.json({ ok: true, pulado: 'janela 00:00-07:00' })
  const lojas = await getLojasEspelhoCompleto()
  const r = await rodarLojasEspelho(lojas, 'ops-abertas', ORCAMENTO_MS, (loja, prazoMs) => sincronizarOpsAbertas(loja, { prazoMs }))
  const falhas = r.filter((x) => x.erro)
  const status = lojas.length && falhas.length === lojas.length ? 502 : 200
  return NextResponse.json({ ok: falhas.length === 0, total: lojas.length, lojas: r }, { status })
}
