import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { processarFilaVendas } from '@/lib/vendas-integracao'

export const maxDuration = 300

// Reenvia o que ficou na vendas_integracao_fila (OP e NFC-e de venda do ntb-vendas
// que falharam por frequencia/rede na hora). Ver lib/vendas-integracao.ts.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const resumo = await processarFilaVendas(createServiceClient(), 10)
  return NextResponse.json({ lojas: resumo })
}
