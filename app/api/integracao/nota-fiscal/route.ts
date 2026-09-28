import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { type IncluirNfcePayload } from '@/lib/omie/nota-fiscal-venda'
import { enviarNfceOuEnfileirar } from '@/lib/vendas-integracao'
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

  if (!loja.is_test && body.tpAmb === 2) {
    return NextResponse.json({ skipped: true, reason: 'NFC-e de homologação não é registrada em loja real' })
  }

  // Falha transitoria (frequencia/rede) vai pra fila vendas_integracao_fila e o
  // cron retry-integracao-vendas reenvia (2026-09-28).
  const r = await enviarNfceOuEnfileirar(supabase, loja, body)
  await logIntegrationAttempt({
    loja_id: loja.id,
    model: 'ImportarNFCe [Norte Para Negócios]',
    request: `chNFe=${body.chNFe} vNF=${body.vNF}`,
    response: r.ok ? JSON.stringify(r.resultado) : undefined,
    code: r.ok ? '0' : undefined,
    error: !r.ok,
    error_message: r.ok ? undefined : (r.naFila ? '[na fila] ' : '') + r.reason,
  })
  return NextResponse.json(r.ok ? { ok: true, resultado: r.resultado } : { ok: false, naFila: r.naFila, reason: r.reason })
}
