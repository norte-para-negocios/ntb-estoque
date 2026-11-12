import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { acessosDaLoja, type Acesso, type Estado, type ModuloId } from './modulos-puro'
import { gravadosDe } from './assinaturas-puro'

export type AcessosCarregados = {
  lojaId: number | null
  acessos: Record<ModuloId, Acesso>
  gravados: Partial<Record<ModuloId, Estado>>
}

/** Acessos da loja atual por módulo. Por requisição. Nunca lança em erro de leitura: cai nos padrões. */
export const carregarAcessos = cache(async (): Promise<AcessosCarregados> => {
  const profile = await getProfile()
  const lojaId = profile.current_loja_id ?? null
  const quem = { superAdmin: profile.is_super_admin === true, admin: profile.perfil === 'Admin' }
  let gravados: Partial<Record<ModuloId, Estado>> = {}
  if (lojaId != null) {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.from('plataforma_assinaturas').select('modulo_id, estado').eq('erp_loja_id', lojaId)
      if (error) console.error('[plataforma] leitura das assinaturas falhou, usando padrões:', error.message)
      gravados = gravadosDe(data, error)
    } catch (e) {
      console.error('[plataforma] leitura das assinaturas falhou, usando padrões:', e)
    }
  }
  return { lojaId, acessos: acessosDaLoja(gravados, lojaId, quem), gravados }
})

/** Para páginas: vitrine redireciona para a página do módulo. */
export async function exigirModulo(modulo: ModuloId): Promise<Acesso> {
  const { acessos } = await carregarAcessos()
  const a = acessos[modulo]
  if (a === 'vitrine') redirect('/modulos/' + modulo)
  return a
}

/** Para ações que gravam: só 'abre' passa. */
export async function exigirEscritaModulo(modulo: ModuloId): Promise<void> {
  const { acessos } = await carregarAcessos()
  const a = acessos[modulo]
  if (a === 'vitrine') throw new Error('Este módulo não está liberado nesta loja.')
  if (a === 'consulta') throw new Error('Módulo suspenso: dá para consultar, mas não lançar.')
}
