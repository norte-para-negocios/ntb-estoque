import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { estornarVenda } from '@/lib/vendas-estorno'
import type { LojaOmie } from '@/lib/omie/client'

// Chamada pelo ntb-vendas quando a nota fiscal de uma venda inteira é cancelada: desfaz
// no Omie da loja o que a venda gerou (saídas de estoque e ordens de produção).
// Mesma autenticação de ../../nota-fiscal/route.ts (API key por loja).
// ATENÇÃO: escreve de verdade no Omie da loja (exceto is_test=true, ver client.ts).
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { pedidoRef?: string } | null
  if (!body?.pedidoRef) return NextResponse.json({ error: 'pedidoRef obrigatório' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<LojaOmie>()
  if (!loja) return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  if (!loja.omie_app_key || !loja.omie_app_secret) return NextResponse.json({ skipped: true, reason: 'Loja sem Omie configurada' })

  try {
    const r = await estornarVenda(supabase, loja, body.pedidoRef)
    return NextResponse.json({ ok: r.falhas === 0, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'Falha ao estornar a venda' }, { status: 400 })
  }
}
