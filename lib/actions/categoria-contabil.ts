'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { registrarAuditoria } from '@/lib/auditoria'

export type CategoriaContabilInput = {
  nome: string
  ativa: boolean
}

// Puramente local: nao existe chamada Omie pra categoria contabil (o Omie nao
// expoe essa classificacao via API pra gravar aqui).
export async function criarCategoriaContabil(dados: CategoriaContabilInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Categorias Contabeis - Criar'))) return { error: 'Sem permissão' }
  if (!dados.nome.trim()) return { error: 'Informe o nome da categoria' }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('categorias_contabeis')
    .insert({ loja_id: lojaId, nome: dados.nome.trim(), ativa: dados.ativa })
    .select('id')
    .single()
  if (error) return { error: error.code === '23505' ? 'Já existe uma categoria com esse nome' : error.message }

  await registrarAuditoria('criar', 'categoria contábil', data.id, dados.nome.trim())
  revalidatePath('/categoria-contabil')
  return { ok: true }
}

export async function editarCategoriaContabil(id: number, dados: CategoriaContabilInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Categorias Contabeis - Editar'))) return { error: 'Sem permissão' }
  if (!dados.nome.trim()) return { error: 'Informe o nome da categoria' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('categorias_contabeis')
    .update({ nome: dados.nome.trim(), ativa: dados.ativa, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('loja_id', lojaId)
  if (error) return { error: error.code === '23505' ? 'Já existe uma categoria com esse nome' : error.message }

  await registrarAuditoria('editar', 'categoria contábil', id, dados.nome.trim())
  revalidatePath('/categoria-contabil')
  return { ok: true }
}

export async function excluirCategoriaContabil(id: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Categorias Contabeis - Excluir'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { data: alvo } = await supabase
    .from('categorias_contabeis')
    .select('nome')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()
  const { error } = await supabase.from('categorias_contabeis').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('excluir', 'categoria contábil', id, alvo?.nome ?? null)
  revalidatePath('/categoria-contabil')
  return { ok: true }
}
