import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchNotaFiscal } from '@/lib/omie/nota-fiscal'
import { fetchOrdemProducao } from '@/lib/omie/ordem-producao'
import { syncLocaisEstoque } from '@/lib/omie/local-estoque'
import type { LojaOmie } from '@/lib/omie/client'

// Topicos de movimentacao de estoque: ignorados (igual ao Laravel, evita loop de ajuste)
const IGNORED_TOPICS = ['Produto.AjusteEstoque', 'Produto.MovimentacaoEstoque']

interface OmieWebhookBody {
  messageId?: string
  appKey?: string
  topic?: string
  event?: { nIdReceb?: number; nCodOP?: number }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as OmieWebhookBody | null
  if (!body?.messageId || !body?.appKey) {
    return NextResponse.json({ ok: true })
  }

  const supabase = createServiceClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('omie_app_key', body.appKey)
    .eq('ativo', true)
    .maybeSingle<LojaOmie>()

  if (!loja) return NextResponse.json({ ok: true })

  // Deduplicacao por messageId
  const { data: existing } = await supabase
    .from('webhooks')
    .select('id')
    .eq('loja_id', loja.id)
    .eq('message_id', body.messageId)
    .maybeSingle()

  if (existing) return NextResponse.json({ ok: true })

  const topic = body.topic ?? ''
  if (IGNORED_TOPICS.some((t) => topic.startsWith(t))) {
    return NextResponse.json({ ok: true })
  }

  await supabase.from('webhooks').insert({
    loja_id: loja.id,
    message_id: body.messageId,
    message: body,
  })

  // Processa por topico. Erros nao quebram a resposta 200 (Omie reenvia se 5xx).
  try {
    if (topic.startsWith('RecebimentoProduto.') && body.event?.nIdReceb) {
      await fetchNotaFiscal(loja, body.event.nIdReceb)
    } else if (topic.startsWith('OrdemProducao.') && topic !== 'OrdemProducao.Excluida' && body.event?.nCodOP) {
      await fetchOrdemProducao(loja, body.event.nCodOP)
    } else if (topic.startsWith('LocalEstoque.')) {
      await syncLocaisEstoque(loja)
    }
  } catch (e) {
    console.error('Erro processando webhook Omie:', e)
  }

  return NextResponse.json({ ok: true })
}
