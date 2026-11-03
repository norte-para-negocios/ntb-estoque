import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { cursoresAvisos } from '@/lib/financeiro-omie/avisos'
import { MODELOS_LOG_PROTEGIDOS, RETENCAO, TOPICOS_WEBHOOK_PROTEGIDOS } from '@/lib/cron/prune-regras'

export const maxDuration = 300

const LOTE = 2000
const ORCAMENTO_MS = 150_000
// Teto por rodada: as duas tabelas têm gatilho outbox_capture (espelho/failover), então cada linha apagada também vira uma
// linha de ~1-2 KB no outbox (hoje 160 MB/dia só de inserts). Com ~440 mil linhas atrasadas, apagar tudo de uma vez
// dobraria o outbox; 50 mil por rodada esvazia o atraso em ~9 dias e depois o regime é ~25 mil/dia.
const TETO_LINHAS_POR_RODADA = 50_000

type Sb = ReturnType<typeof createServiceClient>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filtro = (q: any) => any

/**
 * Apaga em lotes (select de ids + delete por id) para não segurar lock nem estourar o timeout do PostgREST na 1ª rodada
 * (191 mil webhooks atrasados). Para no orçamento de tempo; o que sobrar sai na rodada do dia seguinte.
 * Esta rota só mexe em `webhooks` e `integration_attempts` (log de avisos e de chamadas); nunca em NF, OP ou movimento.
 */
async function apagarEmLotes(sb: Sb, tabela: 'webhooks' | 'integration_attempts', filtro: Filtro, prazo: number, saldo: { linhas: number }): Promise<number> {
  let total = 0
  while (Date.now() < prazo && saldo.linhas > 0) {
    const { data, error } = await filtro(sb.from(tabela).select('id')).order('id', { ascending: true }).limit(Math.min(LOTE, saldo.linhas))
    if (error) throw new Error(`${tabela}: ${error.message}`)
    const ids = ((data ?? []) as { id: number }[]).map((l) => l.id)
    if (!ids.length) break
    const { error: e2 } = await sb.from(tabela).delete().in('id', ids)
    if (e2) throw new Error(`${tabela}: ${e2.message}`)
    total += ids.length
    saldo.linhas -= ids.length
    if (ids.length < LOTE) break
  }
  return total
}

const dias = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
const semTopicosProtegidos: Filtro = (q) => TOPICOS_WEBHOOK_PROTEGIDOS.reduce((acc, t) => acc.not('message->>topic', 'like', t), q)
const semModelosProtegidos: Filtro = (q) => MODELOS_LOG_PROTEGIDOS.reduce((acc, m) => acc.not('model', 'like', m), q)

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createServiceClient()
  const prazo = Date.now() + ORCAMENTO_MS
  const apagadas: Record<string, number> = {}
  const erros: string[] = []
  const passo = async (nome: string, fn: () => Promise<number>) => {
    try { apagadas[nome] = await fn() } catch (e) { erros.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const saldo = { linhas: TETO_LINHAS_POR_RODADA }
  const seteDias = dias(RETENCAO.webhookDias)

  // Financeiro A0 (27/10/2026): aviso Financas.* só sai depois de processado pelo cron sync-financeiro-avisos
  // (webhooks.id <= cursor da loja em espelho_sync_estado 'fin-avisos'). Cursor ilegível = nenhum financeiro apagado.
  // Os demais avisos seguem a regra de sempre (7 dias), menos RecebimentoProduto.* (histórico e releitura da nota).
  await passo('webhooks', () => apagarEmLotes(sb, 'webhooks', (q) => semTopicosProtegidos(q.lt('created_at', seteDias).not('message->>topic', 'like', 'Financas.%')), prazo, saldo))
  try {
    for (const [loja, ultimo] of await cursoresAvisos()) {
      if (ultimo > 0) await passo(`webhooks_financas_loja_${loja}`, () => apagarEmLotes(sb, 'webhooks', (q) => semTopicosProtegidos(q.eq('loja_id', loja).lte('id', ultimo).lt('created_at', seteDias)), prazo, saldo))
    }
  } catch (e) {
    console.error('[prune] cursores dos avisos financeiros ilegíveis; avisos financeiros mantidos:', e)
    erros.push(`cursores dos avisos financeiros: ${e instanceof Error ? e.message : String(e)}`)
  }
  // Logs de integracao crescem ~16 mil/dia. Os de SUCESSO (a grande maioria) so servem por pouco tempo -> apaga > 2 dias.
  // Os ERROS (poucos, uteis p/ debug) ficam ate 30 dias. Log de NFC-e/cupom/OP nunca (ver lib/cron/prune-regras.ts).
  const doisDias = dias(RETENCAO.tentativaSucessoDias)
  await passo('tentativas_sucesso', () => apagarEmLotes(sb, 'integration_attempts', (q) => semModelosProtegidos(q.eq('error', false).lt('created_at', doisDias)), prazo, saldo))
  await passo('tentativas_sem_erro_flag', () => apagarEmLotes(sb, 'integration_attempts', (q) => semModelosProtegidos(q.is('error', null).lt('created_at', doisDias)), prazo, saldo))
  const trintaDias = dias(RETENCAO.tentativaQualquerDias)
  await passo('tentativas_30d', () => apagarEmLotes(sb, 'integration_attempts', (q) => semModelosProtegidos(q.lt('created_at', trintaDias)), prazo, saldo))

  const restou = Date.now() >= prazo
  return NextResponse.json({ ok: erros.length === 0, apagadas, erros, orcamentoEsgotado: restou || saldo.linhas <= 0 }, { status: erros.length ? 500 : 200 })
}
