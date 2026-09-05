import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { incluirNfce, type IncluirNfcePayload } from '@/lib/omie/nota-fiscal-venda'
import { logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'

// Rota externa (não-sessão) pro ntb-vendas disparar o registro de uma
// NFC-e já autorizada pela SEFAZ na Omie da loja. Mesma autenticação de
// app/api/integracao/ordem-producao/route.ts (API key por loja).
// ATENÇÃO: escreve de verdade no Omie da loja (exceto is_test=true, ver
// ehChamadaDeEscrita em lib/omie/client.ts).

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as IncluirNfcePayload | null
  if (!body?.chNFe || !body.itens?.length) {
    return NextResponse.json({ error: 'Payload inválido: chNFe e itens são obrigatórios' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<LojaOmie>()

  if (!loja) {
    return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  }

  if (!loja.omie_app_key || !loja.omie_app_secret) {
    return NextResponse.json({ skipped: true, reason: 'Loja sem Omie configurada' })
  }

  try {
    const resultado = await incluirNfce(loja, body)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'IncluirNfce [Norte Para Negócios]',
      request: `chNFe=${body.chNFe} vNF=${body.vNF}`,
      response: JSON.stringify(resultado),
      code: '0',
    })
    return NextResponse.json({ ok: true, resultado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha desconhecida na chamada Omie'
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'IncluirNfce [Norte Para Negócios]',
      request: `chNFe=${body.chNFe} vNF=${body.vNF}`,
      error: true,
      error_message: msg,
    })
    return NextResponse.json({ ok: false, reason: msg })
  }
}
