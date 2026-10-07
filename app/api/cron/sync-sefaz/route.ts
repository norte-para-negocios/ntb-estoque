import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { lojasParaSefaz, sincronizarSefaz } from '@/lib/estoque/sefaz-sync'

export const maxDuration = 300

// Puxa as notas de entrada da SEFAZ para as lojas de estoque próprio (só leitura + ciência da operação). Roda a cada ciclo do
// sync-cron: a espera de 1 hora que a SEFAZ exige fica em sefaz_nsu.bloqueado_ate, então o ciclo é barato quando não há novidade.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const lojas = await lojasParaSefaz()
  const resultados = []
  for (const id of lojas) resultados.push(await sincronizarSefaz(id)) // uma loja por vez: um certificado, uma consulta
  // "sem trabalho" (loja esperando a SEFAZ, consulta desligada) é saudável; só 502 se houve erro real em TODAS as lojas com trabalho
  const comErro = resultados.filter((r) => !r.ok && r.erro)
  const todasFalharam = lojas.length > 0 && comErro.length === lojas.length
  return NextResponse.json(
    { total: lojas.length, ok: lojas.length - comErro.length, falhas: comErro.length, notas: resultados.reduce((a, r) => a + r.notas, 0), lancadas: resultados.reduce((a, r) => a + r.lancadas, 0) },
    { status: todasFalharam ? 502 : 200 }
  )
}
