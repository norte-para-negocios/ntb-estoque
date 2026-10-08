'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Salva a meta diaria de faturamento da loja ativa (uma linha por loja).
export async function salvarMetaFaturamento(valor: number): Promise<{ ok: true } | { error: string }> {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão' }
  if (!Number.isFinite(valor) || valor < 0) return { error: 'Informe um valor maior ou igual a zero' }
  if (valor > 100_000_000) return { error: 'Valor alto demais' }

  const lojaId = await getCurrentLojaId()
  if (!ator.lojaIds.includes(lojaId)) return { error: 'Sem permissão nesta loja' }
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('metas_faturamento')
    .upsert(
      { loja_id: lojaId, valor_diario: Math.round(valor * 100) / 100, atualizado_em: new Date().toISOString(), atualizado_por: ator.id },
      { onConflict: 'loja_id' },
    )
  if (error) return { error: error.message }

  revalidatePath('/relatorio-meta')
  return { ok: true }
}
