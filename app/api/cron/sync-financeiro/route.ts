import { NextResponse } from 'next/server'
import { assertCronAuth, getLojasFinanceiroOmie } from '@/lib/omie/sync-all'
import { rodarLojasEspelho } from '@/lib/omie/espelho-ciclo'
import { janelaProibida } from '@/lib/estoque/espelho-lojas'
import { sincronizarFinanceiroLoja } from '@/lib/financeiro-omie/sync-loja'

export const maxDuration = 180

/** Tempo do ciclo para todas as lojas juntas (scripts/sync-cron.sh espera até 240 s). */
const ORCAMENTO_MS = 90_000

// Financeiro A0: carga inicial e conferência periódica do financeiro do Omie pela API (SÓ LEITURA: ListarMovimentos,
// ListarCategorias, ListarCadastroDRE, ListarContasCorrentes, ListarExtrato). Lojas uma de cada vez em rodízio, com a
// guarda do espelho (bloqueio, disjuntor, pausa por erro: lib/omie/espelho-ciclo.ts). Nunca entre 00:00 e 07:00 da
// Bahia (a faxina do Mac usa a chave do Omie de madrugada). Desligar: OMIE_FIN_DESLIGADO=1 (ou OMIE_FIN_API_DESLIGADA=1
// para manter só os avisos).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.OMIE_FIN_DESLIGADO === '1' || process.env.OMIE_FIN_API_DESLIGADA === '1') return NextResponse.json({ ok: true, pulado: 'desligado por env' })
  if (janelaProibida(new Date())) return NextResponse.json({ ok: true, pulado: 'janela 00:00-07:00' })
  const { api: lojas } = await getLojasFinanceiroOmie()
  const r = await rodarLojasEspelho(lojas, 'financeiro', ORCAMENTO_MS, (loja, prazoMs) => sincronizarFinanceiroLoja(loja, { prazoMs }))
  const falhas = r.filter((x) => x.erro)
  return NextResponse.json({ ok: falhas.length === 0, total: lojas.length, lojas: r }, { status: lojas.length && falhas.length === lojas.length ? 502 : 200 })
}
