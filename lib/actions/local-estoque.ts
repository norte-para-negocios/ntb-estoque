'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { incluirLocalEstoque, alterarLocalEstoque, syncLocaisEstoque } from '@/lib/omie/local-estoque'
import type { LojaOmie } from '@/lib/omie/client'

/**
 * Exclui um local de estoque APENAS do banco local (nao no Omie).
 * O Omie nao oferece API publica para excluir local de estoque; a exclusao
 * fica no NTB e o registro e ignorado nos proximos syncs (upsert por id).
 */
export async function excluirLocalEstoque(id: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Locais de Estoque - Excluir'))) return { error: 'Sem permissão' }
  if (!id) return { error: 'Local inválido' }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('local_estoques')
    .delete()
    .eq('id', id)
    .eq('loja_id', lojaId)
  if (error) return { error: error.message }

  revalidatePath('/local-estoque')
  return { ok: true }
}

/**
 * Cria um local de estoque no Omie e re-sincroniza (Bloco 9.2). ESCREVE no Omie.
 * Disparo real apenas com o Ramon (regra: nao escrever no Omie em teste sozinho).
 */
export async function criarLocalEstoque(dados: { descricao: string; codigo?: string }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Locais de Estoque - Criar'))) return { error: 'Sem permissão' }
  if (!dados.descricao?.trim()) return { error: 'Informe a descrição do local' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja não encontrada' }

  try {
    await incluirLocalEstoque(loja, {
      descricao: dados.descricao.trim(),
      codigo: dados.codigo?.trim() || undefined,
    })
    // Re-sincroniza para o novo local aparecer no banco com o codigo gerado.
    await syncLocaisEstoque(loja)
    revalidatePath('/local-estoque')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao criar o local no Omie' }
  }
}

/**
 * Altera um local de estoque no Omie (AlterarLocalEstoque) e re-sincroniza.
 * ESCREVE no Omie. So a descricao/codigo mudam; o codigo_local_estoque identifica.
 */
export async function editarLocalEstoque(dados: {
  codigoLocalEstoque: number
  descricao: string
  codigo?: string
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Locais de Estoque - Editar'))) return { error: 'Sem permissão' }
  if (!dados.codigoLocalEstoque) return { error: 'Local inválido' }
  if (!dados.descricao?.trim()) return { error: 'Informe a descrição do local' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja não encontrada' }

  try {
    await alterarLocalEstoque(loja, {
      codigoLocalEstoque: dados.codigoLocalEstoque,
      descricao: dados.descricao.trim(),
      codigo: dados.codigo?.trim() || undefined,
    })
    await syncLocaisEstoque(loja)
    revalidatePath('/local-estoque')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao alterar o local no Omie' }
  }
}
