import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { excluirCupomNfce } from '@/lib/omie/nota-fiscal-venda'
import { logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'

// Chamada pelo ntb-vendas depois que a SEFAZ cancelou a NFC-e: remove cupom e
// titulo do Omie. Mesma autenticacao de ../route.ts (API key por loja).
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { chNFe?: string; tpAmb?: number } | null
  if (!body?.chNFe || !/^\d{44}$/.test(body.chNFe)) {
    return NextResponse.json({ error: 'chNFe (44 digitos) obrigatoria' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<LojaOmie>()
  if (!loja) return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  if (!loja.omie_app_key || !loja.omie_app_secret) return NextResponse.json({ skipped: true, reason: 'Loja sem Omie configurada' })
  if (!loja.is_test && body.tpAmb === 2) {
    return NextResponse.json({ skipped: true, reason: 'NFC-e de homologação não é registrada em loja real' })
  }

  const r = await excluirCupomNfce(supabase, loja, body.chNFe)
  await logIntegrationAttempt({
    loja_id: loja.id,
    model: 'ExcluirCupom [Norte Para Negócios]',
    request: `chNFe=${body.chNFe}`,
    response: r.ok ? JSON.stringify(r) : undefined,
    code: r.ok ? '0' : undefined,
    error: !r.ok,
    error_message: r.ok ? undefined : r.reason,
  })
  return NextResponse.json(r)
}
