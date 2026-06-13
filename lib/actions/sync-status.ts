'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { LojaOmie } from '@/lib/omie/client'
import { syncProdutos } from '@/lib/omie/produto'
import { syncLocaisEstoque } from '@/lib/omie/local-estoque'
import { syncNotasFiscais } from '@/lib/omie/nota-fiscal'
import { syncOrdensProducao } from '@/lib/omie/ordem-producao'

export type SyncModel = 'produto' | 'local' | 'nf' | 'op'

const SYNCS: Record<SyncModel, (loja: LojaOmie) => Promise<unknown>> = {
  produto: syncProdutos,
  local: syncLocaisEstoque,
  nf: syncNotasFiscais,
  op: syncOrdensProducao,
}

/**
 * Re-dispara o sync de leitura do model informado para a loja.
 * Apenas leitura do Omie. Nunca aciona ajuste ou escrita.
 */
export async function reprocessarSync(
  lojaId: number,
  model: SyncModel
): Promise<{ ok: boolean; erro?: string }> {
  if (!SYNCS[model]) {
    return { ok: false, erro: 'Model invalido.' }
  }

  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'

  // Valida acesso: admin OU vinculo com a loja em loja_user.
  if (!isAdmin) {
    const supabaseAuth = createServiceClient()
    const { data: vinculo } = await supabaseAuth
      .from('loja_user')
      .select('id')
      .eq('user_id', profile.id)
      .eq('loja_id', lojaId)
      .maybeSingle()
    if (!vinculo) {
      return { ok: false, erro: 'Sem acesso a esta loja.' }
    }
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .eq('ativo', true)
    .not('omie_app_key', 'is', null)
    .maybeSingle<LojaOmie>()

  if (!loja) {
    return { ok: false, erro: 'Loja sem credenciais Omie configuradas.' }
  }

  try {
    await SYNCS[model](loja)
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha no sync.' }
  }

  revalidatePath('/sync-status')
  return { ok: true }
}
