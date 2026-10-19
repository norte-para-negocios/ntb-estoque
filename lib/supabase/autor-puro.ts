// Puro (sem @/): quando a escrita do service client leva o autor (lib/supabase/server.ts, histórico da migration 220).
export function metodoEscreve(metodo: string | undefined | null): boolean {
  const m = (metodo ?? 'GET').toUpperCase()
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS'
}

/**
 * Só escrita leva o autor, e nunca a que vem de sincronização (cliente criado com `semAutor` — lib/omie/* — ou código
 * rodando dentro de `semAutor()` — rotas /api/sync/*, reprocessar sync): o que veio do Omie é "Sistema", não quem clicou.
 */
export function mandaAutor(a: { metodo: string | undefined | null; clienteSemAutor: boolean; contextoSemAutor: boolean }): boolean {
  return metodoEscreve(a.metodo) && !a.clienteSemAutor && !a.contextoSemAutor
}
