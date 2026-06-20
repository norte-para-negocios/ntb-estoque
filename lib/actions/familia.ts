'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { syncFamilias } from '@/lib/omie/familia'
import { registrarAuditoria } from '@/lib/auditoria'
import type { LojaOmie } from '@/lib/omie/client'

export type FamiliaInput = {
  nome: string
  codigo: string // codInt opcional
  inativo: boolean
}

/**
 * Cria uma familia LOCAL no banco (fonte da verdade; visao de independencia do Omie).
 * NAO escreve no Omie. A escrita no Omie (IncluirFamilia) fica para validar com o Ramon.
 */
export async function criarFamilia(dados: FamiliaInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias - Criar'))) return { error: 'Sem permissão' }
  if (!dados.nome.trim()) return { error: 'Informe o nome da família' }

  const supabase = createServiceClient()
  const { error } = await supabase.from('familias').insert({
    loja_id: lojaId,
    nome: dados.nome.trim(),
    codigo: dados.codigo.trim() || null,
    inativo: dados.inativo,
    origem: 'local',
  })
  if (error) return { error: error.message }

  await registrarAuditoria('criar', 'família', null, dados.nome.trim())
  revalidatePath('/familia')
  return { ok: true }
}

export async function editarFamilia(id: number, dados: FamiliaInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias - Editar'))) return { error: 'Sem permissão' }
  if (!dados.nome.trim()) return { error: 'Informe o nome da família' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('familias')
    .update({
      nome: dados.nome.trim(),
      codigo: dados.codigo.trim() || null,
      inativo: dados.inativo,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('editar', 'família', id, dados.nome.trim())
  revalidatePath('/familia')
  return { ok: true }
}

export async function excluirFamilia(id: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias - Excluir'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { data: alvo } = await supabase.from('familias').select('nome').eq('id', id).eq('loja_id', lojaId).maybeSingle()
  const { error } = await supabase.from('familias').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('excluir', 'família', id, alvo?.nome ?? null)
  revalidatePath('/familia')
  return { ok: true }
}

/**
 * Puxa as familias do Omie (PesquisarFamilias, so leitura) e grava no banco.
 */
export async function puxarFamiliasDoOmie() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias - Sincronizar'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja?.omie_app_key || !loja?.omie_app_secret) return { error: 'Loja sem chave do Omie' }

  try {
    await syncFamilias(loja)
    revalidatePath('/familia')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao puxar do Omie' }
  }
}
