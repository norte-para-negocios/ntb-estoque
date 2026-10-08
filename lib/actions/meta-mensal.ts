'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Salva a meta de faturamento de um mes ('YYYY-MM') para a loja ativa.
export async function salvarMetaMensal(mes: string, valor: number): Promise<{ ok: true } | { error: string }> {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão' }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { error: 'Mês inválido' }
  if (!Number.isFinite(valor) || valor <= 0) return { error: 'Informe um valor maior que zero' }
  if (valor > 1_000_000_000) return { error: 'Valor alto demais' }

  const lojaId = await getCurrentLojaId()
  if (!ator.lojaIds.includes(lojaId)) return { error: 'Sem permissão nesta loja' }
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('metas_mensais')
    .upsert(
      { loja_id: lojaId, mes, valor_mensal: Math.round(valor * 100) / 100, atualizado_em: new Date().toISOString(), atualizado_por: ator.id },
      { onConflict: 'loja_id,mes' },
    )
  if (error) return { error: error.message }

  revalidatePath('/meta-mensal')
  return { ok: true }
}
