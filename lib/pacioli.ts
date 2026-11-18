// Pacioli (robô de correções do estoque no Omie, servidor norte-faxina). Aparece no menu só para dev (admin global/super admin)
// e para as lojas que contrataram o robô. Loja nova que contratar: incluir o id aqui (e criar o login dela no Pacioli).
export const PACIOLI_URL = 'https://pacioli.norteparanegocios.com.br'

/** loja_id (Norte Estoque) -> loja no Pacioli. 5 = Donana Praia do Forte, 2 = Donana Vilas do Atlântico. */
export const LOJAS_PACIOLI: Record<number, 'pf' | 'vilas'> = { 5: 'pf', 2: 'vilas' }

export function pacioliLiberado(lojaId: number | null | undefined, isAdmin: boolean, isSuperAdmin: boolean): boolean {
  if (isAdmin || isSuperAdmin) return true
  return lojaId != null && lojaId in LOJAS_PACIOLI
}

/**
 * Trava de ambiente (F-11): o Pacioli é um serviço de PRODUÇÃO (robô que corrige estoque no Omie). Cópia local de teste
 * (NTB_OMIE_BLOQUEADO=1), `next dev` ou NTB_PACIOLI_BLOQUEADO=1 não podem fazer o navegador falar com ele.
 * NTB_PACIOLI_LIBERADO=1 reabre de propósito (quem testa o Pacioli de verdade).
 */
export function pacioliBloqueadoNoAmbiente(env: Record<string, string | undefined>): boolean {
  if (env.NTB_PACIOLI_LIBERADO === '1') return false
  return env.NTB_OMIE_BLOQUEADO === '1' || env.NTB_PACIOLI_BLOQUEADO === '1' || env.NODE_ENV === 'development'
}
