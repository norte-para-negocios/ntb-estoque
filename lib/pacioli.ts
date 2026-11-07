// Pacioli (robô de correções do estoque no Omie, servidor norte-faxina). Aparece no menu só para dev (admin global/super admin)
// e para as lojas que contrataram o robô. Loja nova que contratar: incluir o id aqui (e criar o login dela no Pacioli).
export const PACIOLI_URL = 'https://pacioli.norteparanegocios.com.br'

/** loja_id (Norte Estoque) -> loja no Pacioli. 5 = Donana Praia do Forte, 2 = Donana Vilas do Atlântico. */
export const LOJAS_PACIOLI: Record<number, 'pf' | 'vilas'> = { 5: 'pf', 2: 'vilas' }

export function pacioliLiberado(lojaId: number | null | undefined, isAdmin: boolean, isSuperAdmin: boolean): boolean {
  if (isAdmin || isSuperAdmin) return true
  return lojaId != null && lojaId in LOJAS_PACIOLI
}
