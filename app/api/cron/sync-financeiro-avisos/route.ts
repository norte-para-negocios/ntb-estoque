import { NextResponse } from 'next/server'
import { assertCronAuth, getLojasFinanceiroOmie } from '@/lib/omie/sync-all'
import { processarAvisosLoja, type ResumoAvisos } from '@/lib/financeiro-omie/avisos'

export const maxDuration = 120

/** Tempo do ciclo para todas as lojas juntas (scripts/sync-cron.sh espera até 240 s). */
const ORCAMENTO_MS = 60_000

// Financeiro A0: avisos Financas.* já gravados em `webhooks` → espelho omie_fin_* (só banco, NÃO chama o Omie; por isso
// roda também de madrugada). A rota do webhook não muda: o aviso continua sendo só gravado na hora.
// Desligar: OMIE_FIN_DESLIGADO=1.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.OMIE_FIN_DESLIGADO === '1') return NextResponse.json({ ok: true, pulado: 'OMIE_FIN_DESLIGADO' })
  const { avisos: lojas } = await getLojasFinanceiroOmie()
  const prazo = Date.now() + ORCAMENTO_MS
  const out: (ResumoAvisos | { loja: number; erro: string })[] = []
  for (const loja of lojas) {
    if (Date.now() > prazo) { out.push({ loja: loja.id, erro: 'orçamento do ciclo esgotado (fica para o próximo)' }); continue }
    try {
      out.push(await processarAvisosLoja(loja.id, { prazoMs: prazo }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[financeiro-avisos] loja ${loja.id}: ${msg}`)
      out.push({ loja: loja.id, erro: msg })
    }
  }
  const falhas = out.filter((x) => 'erro' in x && x.erro && !x.erro.startsWith('orçamento'))
  return NextResponse.json({ ok: falhas.length === 0, lojas: out }, { status: lojas.length && falhas.length === lojas.length ? 502 : 200 })
}
