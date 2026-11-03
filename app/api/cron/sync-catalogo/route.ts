import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { rodarSyncCatalogo } from '@/lib/estoque/catalogo-sync'

export const maxDuration = 300

// Sincronização automática do catálogo Vendas <-> Estoque (lojas modo 'proprio'):
// liga a loja ao Vendas se faltar, reconcilia os dois catálogos e entrega o outbox. Nunca toca lojas Omie.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await rodarSyncCatalogo()
  // 502 quando havia trabalho e NADA deu certo (regra antiga); falha parcial -> 500 (Fase 1, B1)
  const status = r.lojas > 0 && r.ok === 0 ? 502 : r.falhas > 0 ? 500 : 200
  return NextResponse.json(r, { status })
}
