import { NextResponse } from 'next/server'
import { assertCronAuth, getLojasEspelhoCompleto } from '@/lib/omie/sync-all'
import { sincronizarKardexLoja } from '@/lib/omie/kardex-loja'
import { janelaProibida } from '@/lib/estoque/espelho-lojas'
import type { ResumoCiclo } from '@/lib/omie/espelho-estado'

export const maxDuration = 300

// Kardex da loja inteira (espelho completo, migration 160): só lojas com espelho_completo, uma de cada vez.
// Nunca entre 00:00 e 07:00 da Bahia (a faxina do Mac usa a mesma chave do Omie de madrugada).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (janelaProibida(new Date())) return NextResponse.json({ ok: true, pulado: 'janela 00:00-07:00' })
  const lojas = await getLojasEspelhoCompleto()
  const resumos: ResumoCiclo[] = []
  const falhas: { loja: number; erro: string }[] = []
  for (const loja of lojas) {
    try { resumos.push(await sincronizarKardexLoja(loja)) }
    catch (e) { falhas.push({ loja: loja.id, erro: e instanceof Error ? e.message : String(e) }) }
  }
  const status = lojas.length && falhas.length === lojas.length ? 502 : 200
  return NextResponse.json({ ok: falhas.length === 0, total: lojas.length, resumos, falhas }, { status })
}
