'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { concluirOrdemProducao } from '@/lib/omie/ordem-producao'
import type { LojaOmie } from '@/lib/omie/client'

export async function setValidadeOP(opId: number, validade: string | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase
    .from('ordens_producao')
    .update({ validade, updated_at: new Date().toISOString() })
    .eq('id', opId)
    .eq('loja_id', lojaId)
  revalidatePath('/ordem-producao')
}

export async function setQuantidadeOP(opId: number, quantidade: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase
    .from('ordens_producao')
    .update({ quantidade, updated_at: new Date().toISOString() })
    .eq('id', opId)
    .eq('loja_id', lojaId)
  revalidatePath('/ordem-producao')
}

export async function finishOP(opId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: op } = await supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_op, quantidade, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .single<{
      identificacao_n_cod_op: number | null
      quantidade: number | null
      loja: LojaOmie
    }>()

  if (!op?.identificacao_n_cod_op || !op.loja) {
    return { error: 'Ordem de producao nao encontrada' }
  }

  try {
    const hoje = new Date().toLocaleDateString('pt-BR')
    await concluirOrdemProducao(op.loja, op.identificacao_n_cod_op, hoje, op.quantidade ?? 1, '')
    revalidatePath('/ordem-producao')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao concluir no Omie' }
  }
}
