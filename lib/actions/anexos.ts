'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

// Fase G [O2]: excluir anexo (apaga o arquivo do bucket e marca a linha com quem/quando; a linha não some).
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getProfile } from '@/lib/auth'
import { BUCKET_ANEXOS, contextoAnexo, ehEntidadeAnexo } from '@/lib/anexos/servidor'

export async function excluirAnexo(id: number): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('anexos#excluirAnexo', excluirAnexo, [id]); if (__d) return __d as never
  if (!Number.isInteger(id) || id <= 0) return { error: 'Anexo inválido' }
  const lojaId = await getCurrentLojaId()
  const sb = createServiceClient()
  const { data: a } = await sb.from('anexos').select('id, entidade, caminho, excluido_em').eq('id', id).eq('loja_id', lojaId).maybeSingle()
  if (!a || a.excluido_em || !ehEntidadeAnexo(a.entidade)) return { error: 'Anexo não encontrado' }
  const ctx = await contextoAnexo(a.entidade, 'excluir')
  if ('error' in ctx) return { error: ctx.error }
  const perfil = await getProfile()
  // Marca primeiro (só se ainda não excluído: dois cliques não excluem duas vezes) e depois apaga o arquivo.
  const { data: marcado, error } = await sb.from('anexos')
    .update({ excluido_em: new Date().toISOString(), excluido_por: perfil.id, excluido_por_nome: perfil.name })
    .eq('id', id).eq('loja_id', lojaId).is('excluido_em', null).select('id')
  if (error) return { error: 'Não foi possível excluir agora' }
  if (!marcado?.length) return { ok: true }
  const { error: errRm } = await sb.storage.from(BUCKET_ANEXOS).remove([a.caminho as string])
  if (errRm) console.error(`anexos: anexo ${id} marcado como excluído, mas o arquivo não saiu do bucket: ${errRm.message}`)
  return { ok: true }
}
