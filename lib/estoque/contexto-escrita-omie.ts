// Contexto comum das escritas no Omie pela tela ("nosso Omie" Fase 4). Só servidor (sem 'use server': exportar de
// um arquivo de server actions vira endpoint público).
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import type { LojaOmie } from '@/lib/omie/client'
import { bloqueioDeEscrita } from './escrita-omie-puro'

export type LojaEscrita = LojaOmie & { modo_estoque: string | null; loja_origem_id: number | null }

/**
 * Loja atual + permissão + bloqueios (loja 4, modo diferente de omie). `lojas` sempre com is_test no select:
 * sem ele o gate de escrita simulada do omieRequest trataria a loja de teste como real (AGENTS.md "Lojas de Teste").
 */
export async function contextoEscritaOmie(...permissoes: string[]): Promise<{ lojaId: number; loja: LojaEscrita } | { error: string }> {
  return contextoEscritaOmieCom({}, ...permissoes)
}

/** Igual a contextoEscritaOmie, com opções do bloqueio (ver bloqueioDeEscrita). */
export async function contextoEscritaOmieCom(o: { permitirLoja4?: boolean }, ...permissoes: string[]): Promise<{ lojaId: number; loja: LojaEscrita } | { error: string }> {
  const lojaId = await getCurrentLojaId()
  for (const p of permissoes) {
    if (!(await requirePermissao(lojaId, p))) return { error: `Sem permissão (${p}).` }
  }
  const { data: loja, error } = await createServiceClient()
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test, modo_estoque, loja_origem_id')
    .eq('id', lojaId)
    .maybeSingle<LojaEscrita>()
  if (error || !loja) return { error: 'Loja não encontrada.' }
  if (typeof loja.is_test !== 'boolean') return { error: 'Não foi possível confirmar se a loja é de teste.' }
  const bloqueio = bloqueioDeEscrita({ id: loja.id, modo: loja.modo_estoque ?? 'omie' }, o)
  if (bloqueio) return { error: bloqueio }
  if (!loja.omie_app_key) return { error: 'Loja sem integração com o Omie.' }
  return { lojaId, loja }
}
