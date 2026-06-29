import { NextResponse } from 'next/server'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'
import { syncAjustes } from '@/lib/omie/sync-ajustes'

export const maxDuration = 300

// Sincroniza ajustes de estoque (ENT/SAI/TRF/TPQ/SLD) do Omie → movimentos.
// Incremental: só traz registros com id_ajuste maior que o maior já salvo.
// Roda em background nas últimas páginas da API (sort ASC → última = mais recente).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lojas = await getLojasAtivas()
  if (!lojas.length) return NextResponse.json({ ok: true, msg: 'nenhuma loja' })

  // Exclui loja 4 (O SERTAO VAI VIRAR MAR - produção protegida)
  const lojasSync = lojas.filter((l) => l.id !== 4)

  const results = await Promise.allSettled(lojasSync.map((loja) => syncAjustes(loja)))

  let totalLinhas = 0
  const falhas: { loja: number; erro: string }[] = []

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      totalLinhas += r.value
    } else {
      falhas.push({ loja: lojasSync[i].id, erro: String(r.reason) })
    }
  }

  return NextResponse.json({
    ok: falhas.length === 0,
    total_lojas: lojasSync.length,
    ok_lojas: lojasSync.length - falhas.length,
    linhas_gravadas: totalLinhas,
    falhas,
  })
}
