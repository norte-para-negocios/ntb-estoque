'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Define o estoque minimo de um produto no NTB (o Omie traz 0). Base do alerta de reposicao.
export async function setEstoqueMinimo(produtoId: number, valor: number | null) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) return { error: 'Sem permissão' }
  if (valor != null && (Number.isNaN(valor) || valor < 0)) {
    return { error: 'Valor inválido' }
  }
  const supabase = createServiceClient()
  await supabase
    .from('produtos')
    .update({ estoque_minimo: valor, updated_at: new Date().toISOString() })
    .eq('id', produtoId)
    .eq('loja_id', lojaId)
  revalidatePath('/produto')
  return { ok: true }
}
