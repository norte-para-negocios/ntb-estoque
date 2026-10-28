// Financeiro A0: processa os avisos `Financas.*` que a rota do webhook já grava em `webhooks` (sem mexer na rota).
// Desenho: cron separado, por loja, com cursor = maior webhooks.id já processado (espelho_sync_estado, frente
// 'fin-avisos'). Só pega aviso com mais de 2 min (o insert do aviso já foi confirmado; nenhum id menor aparece depois).
// Gravação idempotente pela chave do Omie e só com dado mais novo (fonte_em = hora do aviso): reprocessar o mesmo lote,
// ou processar fora de ordem, não muda o resultado. Erro de banco = o cursor não anda e o lote volta no próximo ciclo.
// Não chama o Omie.
import { createServiceClient } from '@/lib/supabase/server'
import { gravarEstadoSync, lerEstadoSync } from '@/lib/omie/espelho-estado'
import { juntarAvisos, linhasDoAviso, type AvisoGravado } from './normalizar'

export const FRENTE_AVISOS = 'fin-avisos'
const LOTE = 1000
const MARGEM_MS = 120_000

export function lerCursorAvisos(bruto: unknown): { ultimo_id: number; processados: number } {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const id = Number(b.ultimo_id), n = Number(b.processados)
  return { ultimo_id: Number.isSafeInteger(id) && id > 0 ? id : 0, processados: Number.isSafeInteger(n) && n > 0 ? n : 0 }
}

async function rpcLotes(nome: string, lojaId: number, linhas: unknown[]): Promise<number> {
  const db = createServiceClient({ semAutor: true })
  let n = 0
  for (let i = 0; i < linhas.length; i += 500) {
    const { data, error } = await db.rpc(nome, { p_loja: lojaId, p_linhas: linhas.slice(i, i + 500) })
    if (error) throw new Error(`${nome}: ${error.message}`)
    n += Number((data as { gravados?: number } | null)?.gravados ?? 0)
  }
  return n
}

export type ResumoAvisos = { loja: number; lotes: number; avisos: number; ignorados: number; gravados: number; ate_id: number; erro?: string }

/** Processa os avisos financeiros pendentes de UMA loja, até `maxLotes` lotes ou o prazo. */
export async function processarAvisosLoja(lojaId: number, opcoes: { maxLotes?: number; prazoMs?: number } = {}): Promise<ResumoAvisos> {
  const db = createServiceClient({ semAutor: true })
  const cursor = lerCursorAvisos(await lerEstadoSync(lojaId, FRENTE_AVISOS))
  const r: ResumoAvisos = { loja: lojaId, lotes: 0, avisos: 0, ignorados: 0, gravados: 0, ate_id: cursor.ultimo_id }
  const maxLotes = opcoes.maxLotes ?? 5
  while (r.lotes < maxLotes && Date.now() < (opcoes.prazoMs ?? Infinity)) {
    const { data, error } = await db.from('webhooks').select('id, loja_id, created_at, message')
      .eq('loja_id', lojaId).gt('id', r.ate_id).lt('created_at', new Date(Date.now() - MARGEM_MS).toISOString())
      .like('message->>topic', 'Financas.%').order('id', { ascending: true }).limit(LOTE)
    if (error) throw new Error(`webhooks: ${error.message}`)
    const avisos = (data ?? []) as AvisoGravado[]
    if (!avisos.length) break
    const j = juntarAvisos(avisos.map(linhasDoAviso))
    // Títulos antes do rateio/baixas (a linha mínima do rateio é criada se o título ainda não chegou).
    r.gravados += await rpcLotes('omie_fin_gravar_titulos', lojaId, j.titulos)
    r.gravados += await rpcLotes('omie_fin_gravar_baixas', lojaId, j.baixas)
    r.gravados += await rpcLotes('omie_fin_gravar_lancamentos_cc', lojaId, j.lancamentos)
    r.lotes++
    r.avisos += avisos.length
    r.ignorados += j.ignorados
    r.ate_id = Number(avisos[avisos.length - 1].id)
    await gravarEstadoSync(lojaId, FRENTE_AVISOS, { ultimo_id: r.ate_id, processados: cursor.processados + r.avisos }, null)
    if (avisos.length < LOTE) break
  }
  return r
}

/** Maior webhooks.id já processado por loja (para o prune não apagar aviso financeiro ainda não processado). */
export async function cursoresAvisos(): Promise<Map<number, number>> {
  const { data, error } = await createServiceClient({ semAutor: true }).from('espelho_sync_estado').select('loja_id, estado').eq('frente', FRENTE_AVISOS)
  if (error) throw new Error(`espelho_sync_estado (${FRENTE_AVISOS}): ${error.message}`)
  return new Map((data ?? []).map((l) => [Number(l.loja_id), lerCursorAvisos(l.estado).ultimo_id]))
}
