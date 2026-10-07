import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarFechamento, validarFechamento, type FechamentoBody } from '@/lib/estoque/fechamento'

// Chamada pelo ntb-vendas quando uma mesa/balcão é fechada (e de novo se a venda mudar ou for cancelada).
// Só para lojas em modo 'proprio': grava a venda aqui, reconstrói o faturamento do mês e espelha o fato no Contabo,
// para os relatórios de Faturamento e Lucro funcionarem sem o Omie. Autenticada pela chave de integração da loja
// (mesma das outras rotas desta pasta) e idempotente por pedidoRef.
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as FechamentoBody | null
  const invalido = validarFechamento(body)
  if (invalido) return NextResponse.json({ error: invalido }, { status: 400 })

  const supabase = createServiceClient()
  const { data: loja } = await supabase.from('lojas').select('id, modo_estoque').eq('integracao_api_key', apiKey).eq('ativo', true).maybeSingle<{ id: number; modo_estoque: string | null }>()
  if (!loja) return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  if (loja.modo_estoque !== 'proprio') return NextResponse.json({ ok: true, skipped: true, reason: 'Loja sem estoque próprio: o faturamento segue o caminho de sempre' })

  const r = await registrarFechamento(supabase, loja.id, body as FechamentoBody)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
