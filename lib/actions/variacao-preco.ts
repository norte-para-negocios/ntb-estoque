'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { registrarAuditoria } from '@/lib/auditoria'
import { lerLimitePct } from '@/lib/compras/variacao-preco-puro'

// T5.4 (Fase 5), só desenvolvedor: limite (%) do alerta de variação de preço na nota, por loja (estoque_config, migration 400).
// Fora da política offline de propósito (lib/offline/politica.ts): a coluna só existe no desktop depois do gerar-schema.

type Resposta = { ok: true } | { error: string }

export async function salvarLimiteVariacaoPreco(pct: number | string): Promise<Resposta> {
  const __d = viaDesktop('variacao-preco#salvarLimiteVariacaoPreco', salvarLimiteVariacaoPreco, [pct]); if (__d) return __d as never
  await exigirDevAcao()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa o estoque próprio.' }
  if (!(await getAtorGestao()).podeGerir) return { error: 'Sem permissão' }
  const n = String(pct ?? '').trim() === '' ? null : lerLimitePct(pct)
  if (n == null) return { error: 'Use um número maior que 0 e até 1000 (ex.: 15 ou 12,5).' }
  const { error } = await createServiceClient().from('estoque_config')
    .upsert({ loja_id: lojaId, alerta_variacao_preco_pct: n, updated_at: new Date().toISOString() }, { onConflict: 'loja_id' })
  if (error) return { error: error.message }
  await registrarAuditoria('editar', 'alerta de variação de preço', lojaId, `${n}%`)
  revalidatePath('/relatorio-variacao-preco')
  revalidatePath('/nota-fiscal')
  return { ok: true }
}
