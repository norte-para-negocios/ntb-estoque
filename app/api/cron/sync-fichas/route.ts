import { NextResponse } from 'next/server'
import { assertCronAuth, getLojasEspelhoCompleto } from '@/lib/omie/sync-all'
import { sincronizarFichasLoja, type ResumoFichas } from '@/lib/omie/fichas'
import { janelaProibida } from '@/lib/estoque/espelho-lojas'

export const maxDuration = 300

// Fichas técnicas automáticas (espelho completo, migration 160): até 20 produtos PA/PI por loja e ciclo, refaz a
// cada 7 dias. Lojas com espelho_completo, uma de cada vez; nunca entre 00:00 e 07:00 da Bahia.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (janelaProibida(new Date())) return NextResponse.json({ ok: true, pulado: 'janela 00:00-07:00' })
  const lojas = await getLojasEspelhoCompleto()
  const resumos: ResumoFichas[] = []
  const falhas: { loja: number; erro: string }[] = []
  for (const loja of lojas) {
    try { resumos.push(await sincronizarFichasLoja(loja)) }
    catch (e) { falhas.push({ loja: loja.id, erro: e instanceof Error ? e.message : String(e) }) }
  }
  const status = lojas.length && falhas.length === lojas.length ? 502 : 200
  return NextResponse.json({ ok: falhas.length === 0, total: lojas.length, resumos, falhas }, { status })
}
