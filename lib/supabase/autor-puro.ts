// Puro (sem @/): só escrita leva o autor (lib/supabase/server.ts, histórico da migration 220).
export function metodoEscreve(metodo: string | undefined | null): boolean {
  const m = (metodo ?? 'GET').toUpperCase()
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS'
}
