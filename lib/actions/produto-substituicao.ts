'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { registrarAuditoria } from '@/lib/auditoria'

export type ProdutoSubstituicaoInput = {
  n_cod_prod: number
  substitui_n_cod_prod: number
}

// Puramente local: nao existe conceito de "produto substituto" no Omie.
export async function criarProdutoSubstituicao(dados: ProdutoSubstituicaoInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produto Substituicoes - Criar'))) return { error: 'Sem permissão' }
  if (dados.n_cod_prod === dados.substitui_n_cod_prod) {
    return { error: 'Um produto não pode substituir a si mesmo' }
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('produto_substituicoes')
    .insert({ loja_id: lojaId, n_cod_prod: dados.n_cod_prod, substitui_n_cod_prod: dados.substitui_n_cod_prod })
    .select('id')
    .single()
  if (error) return { error: error.code === '23505' ? 'Esse produto já tem um substituto vinculado' : error.message }

  await registrarAuditoria('criar', 'produto substituição', data.id, `${dados.n_cod_prod} -> ${dados.substitui_n_cod_prod}`)
  revalidatePath('/produto-substituicao')
  return { ok: true }
}

export async function excluirProdutoSubstituicao(id: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produto Substituicoes - Excluir'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { error } = await supabase.from('produto_substituicoes').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('excluir', 'produto substituição', id, null)
  revalidatePath('/produto-substituicao')
  return { ok: true }
}
