import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { rodarSyncCatalogo } from '@/lib/estoque/catalogo-sync'

export const maxDuration = 300

// Sincronização automática do catálogo Vendas <-> Estoque (lojas modo 'proprio'):
// liga a loja ao Vendas se faltar, reconcilia os dois catálogos e entrega o outbox. Nunca toca lojas Omie.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await rodarSyncCatalogo()
  // 502 só quando havia trabalho e NADA deu certo (mesmo padrão dos outros crons)
  const status = r.lojas > 0 && r.ok === 0 ? 502 : 200
  return NextResponse.json(r, { status })
}
