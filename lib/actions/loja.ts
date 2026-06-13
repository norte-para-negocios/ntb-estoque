'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

/**
 * Force-sync da loja (admin): zera os campos *_status para null, fazendo o proximo
 * webhook/sync reprocessar do zero. Espelha o forceSync de loja do sistema Laravel.
 */
export async function forceSyncLoja(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Somente administradores' }

  const supabase = createServiceClient()
  await supabase
    .from('lojas')
    .update({
      produto_status: null,
      local_estoque_status: null,
      posicao_estoque_status: null,
      nota_fiscal_status: null,
      ordem_producao_status: null,
    })
    .eq('id', lojaId)

  revalidatePath('/loja')
  return { ok: true }
}
