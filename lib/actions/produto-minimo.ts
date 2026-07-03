'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Define o estoque minimo de um produto no NTB (o Omie traz 0). Base do alerta de reposicao.
export async function setEstoqueMinimo(produtoId: number, valor: number | null) {
  const lojaId = await getCurrentLojaId()
  // Definir o estoque minimo manual e uma edicao do produto.
  if (!(await requirePermissao(lojaId, 'Produtos - Editar'))) return { error: 'Sem permissão' }
  if (valor != null && (Number.isNaN(valor) || valor < 0)) {
    return { error: 'Valor inválido' }
  }
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('produtos')
    .update({ estoque_minimo: valor, updated_at: new Date().toISOString() })
    .eq('id', produtoId)
    .eq('loja_id', lojaId)
    .select('id')
  if (error) return { error: error.message }
  // .update() nao erra quando o WHERE nao bate com nenhuma linha (ex.: produto de
  // outra loja); sem checar o retorno, a funcao dizia "ok" sem ter salvo nada.
  if (!data?.length) return { error: 'Produto não encontrado' }
  revalidatePath('/produto')
  return { ok: true }
}
