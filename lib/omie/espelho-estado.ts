import { createServiceClient } from '@/lib/supabase/server'

/**
 * Cursor dos crons do espelho completo (espelho_sync_estado, migration 160), por loja + frente.
 * Falha de leitura LANÇA: seguir com estado vazio reiniciaria o backfill do zero em silêncio.
 */
export async function lerEstadoSync(lojaId: number, frente: string): Promise<unknown> {
  const { data, error } = await createServiceClient()
    .from('espelho_sync_estado').select('estado').eq('loja_id', lojaId).eq('frente', frente).maybeSingle()
  if (error) throw new Error(`espelho_sync_estado (${frente}): ${error.message}`)
  return data?.estado ?? null
}

export async function gravarEstadoSync(lojaId: number, frente: string, estado: unknown, ultimoErro: string | null = null): Promise<void> {
  const { error } = await createServiceClient().from('espelho_sync_estado').upsert(
    { loja_id: lojaId, frente, estado, ultimo_erro: ultimoErro, atualizado_em: new Date().toISOString() },
    { onConflict: 'loja_id,frente' }
  )
  if (error) throw new Error(`gravar espelho_sync_estado (${frente}): ${error.message}`)
}

/** Locais ativos da loja (códigos do Omie), ordenados. Erro de consulta lança. */
export async function locaisAtivos(lojaId: number): Promise<number[]> {
  const { data, error } = await createServiceClient()
    .from('local_estoques').select('codigo_local_estoque').eq('loja_id', lojaId)
    .or('inativo.is.null,inativo.neq.S').order('codigo_local_estoque')
  if (error) throw new Error(`local_estoques: ${error.message}`)
  return [...new Set((data ?? []).map((l) => Number(l.codigo_local_estoque)).filter((n) => Number.isFinite(n) && n > 0))]
}

export type ResumoCiclo = { loja: number; paginas: number; linhas: number; parouPor: string | null; historicoDesde: string | null }

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
