'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Mapeamento "qual local de estoque e' a Cozinha / o Bar" pra essa loja
// (migration 120, 2026-08-16, pedido explicito do usuario): a Ordem de
// Producao disparada pelo ntb-vendas passa a usar o local certo conforme
// onde o item foi preparado, em vez de sempre cair no local padrao do Omie.
// Guarda o CODIGO OMIE do local (local_estoques.codigo_local_estoque), que e'
// o que incluirOrdemProducao ja aceita direto -- nao precisa de join na hora
// de criar a OP.
export async function salvarMapeamentoLocalEstoque(
  lojaId: number,
  cozinhaCodigo: number | null,
  barCodigo: number | null
) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('lojas')
    .update({
      local_estoque_cozinha_codigo: cozinhaCodigo,
      local_estoque_bar_codigo: barCodigo,
    })
    .eq('id', lojaId)
  if (error) return { error: error.message }

  revalidatePath('/loja')
  return { ok: true }
}
