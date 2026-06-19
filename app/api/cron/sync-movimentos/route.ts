import { NextResponse } from 'next/server'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'
import { syncMovimentos } from '@/lib/omie/sync-movimentos'

export const maxDuration = 300

// Sincroniza movimentos de estoque (entradas/saidas por produto/dia) do Omie
// para movimentos_historico. Roda mes-a-mes (mes passado + mes atual) para
// evitar o truncamento silencioso do ListarMovimentos em janelas longas.
//
// Agendamento recomendado: 1x por dia (vercel.json) + entrada no sync-omie.yml
// se quiser frequencia maior. Rate limit: ~700ms entre paginas por loja.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lojas = await getLojasAtivas()
  if (!lojas.length) return NextResponse.json({ ok: true, msg: 'nenhuma loja' })

  const results = await Promise.allSettled(lojas.map((loja) => syncMovimentos(loja)))

  let totalLinhas = 0
  const falhas: { loja: number; erro: string }[] = []

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      totalLinhas += r.value
    } else {
      falhas.push({ loja: lojas[i].id, erro: String(r.reason) })
    }
  }

  return NextResponse.json({
    ok: falhas.length === 0,
    total_lojas: lojas.length,
    ok_lojas: lojas.length - falhas.length,
    linhas_gravadas: totalLinhas,
    falhas,
  })
}
