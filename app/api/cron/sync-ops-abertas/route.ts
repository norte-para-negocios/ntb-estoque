import { NextResponse } from 'next/server'
import { assertCronAuth, getLojasEspelhoCompleto } from '@/lib/omie/sync-all'
import { sincronizarOpsAbertas, type ResumoOps } from '@/lib/omie/ops-abertas'
import { janelaProibida } from '@/lib/estoque/espelho-lojas'

export const maxDuration = 300

// Todas as OPs abertas do Omie + ficha gravada na OP (espelho completo, migration 160). Lojas com espelho_completo,
// uma de cada vez, no máximo 1 leitura completa a cada 30 min por loja; nunca entre 00:00 e 07:00 da Bahia.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (janelaProibida(new Date())) return NextResponse.json({ ok: true, pulado: 'janela 00:00-07:00' })
  const lojas = await getLojasEspelhoCompleto()
  const resumos: ResumoOps[] = []
  const falhas: { loja: number; erro: string }[] = []
  for (const loja of lojas) {
    try { resumos.push(await sincronizarOpsAbertas(loja)) }
    catch (e) { falhas.push({ loja: loja.id, erro: e instanceof Error ? e.message : String(e) }) }
  }
  const status = lojas.length && falhas.length === lojas.length ? 502 : 200
  return NextResponse.json({ ok: falhas.length === 0, total: lojas.length, resumos, falhas }, { status })
}
