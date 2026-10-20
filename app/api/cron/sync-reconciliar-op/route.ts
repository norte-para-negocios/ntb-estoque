import { NextResponse } from 'next/server'
import { reconciliarOPsFantasmas } from '@/lib/omie/ordem-producao'
import { getLojasAtivas, assertCronAuth, lojasOpTempoReal } from '@/lib/omie/sync-all'

export const maxDuration = 300

// Achado 2026-07-10: um lote de OPs ficou "fantasma" no banco (excluido direto no
// Omie sem o nosso sync detectar, ja que syncOrdensProducao filtra por data de
// CONCLUSAO e uma OP aberta nunca tem isso). Roda separado do sync-ops principal
// pra nao competir pelo maxDuration; verifica ate 40 OPs abertas e atrasadas por
// loja por dia (rate limit do Omie), entao um backlog grande esvazia aos poucos.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // 16/10: loja em faxina fica fora -- a faxina deixa dezenas de OPs abertas de proposito e consultar 40 delas a
  // cada 10 min bloqueia o Omie (MISUSE em ConsultarOrdemProducao). Desde 20/10 (D5) o critério é a coluna
  // `lojas.omie_op_tempo_real` (migration 250), não mais `espelho_completo` (que valia false em todas as lojas).
  const ligadas = await lojasOpTempoReal()
  const lojas = (await getLojasAtivas()).filter((l) => ligadas.has(l.id))
  const results = await Promise.allSettled(lojas.map((loja) => reconciliarOPsFantasmas(loja, 3, 40)))
  const resumo = results.map((r, i) => ({
    loja_id: lojas[i].id,
    ...(r.status === 'fulfilled' ? r.value : { erro: r.reason instanceof Error ? r.reason.message : String(r.reason) }),
  }))
  return NextResponse.json({ total_lojas: lojas.length, resumo })
}
