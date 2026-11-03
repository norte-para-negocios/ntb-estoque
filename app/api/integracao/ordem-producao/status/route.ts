import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { montarStatusPedido, normalizarPedidoRef, ehTabelaAusente, type LinhaRegistroPedido } from '@/lib/vendas/registro-pedido-venda'

// GET /api/integracao/ordem-producao/status?pedidoRef=<id do pedido no Norte Vendas> (02/11/2026).
// O Vendas consulta quando a baixa ficou "incerta" (desistiu de esperar a resposta do POST). Responde a partir do
// registro que o POST grava ANTES de mexer no estoque (venda_integracao_pedidos, migration 308): se chegou, se
// terminou e o resultado de cada item. Só leitura: não chama o Omie. Mesma autenticação das outras rotas de
// integração (lojas.integracao_api_key). Tabela ausente/erro = 503 (o Vendas mantém a baixa incerta).
export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })

  const pedidoRef = normalizarPedidoRef(new URL(request.url).searchParams.get('pedidoRef'))
  if (!pedidoRef) return NextResponse.json({ error: 'Informe pedidoRef' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<{ id: number }>()
  if (!loja) return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })

  const [linhas, primeiro, ultimo] = await Promise.all([
    supabase
      .from('venda_integracao_pedidos')
      .select('recebido_em, concluido_em, itens, resultados')
      .eq('loja_id', loja.id)
      .eq('pedido_ref', pedidoRef)
      .order('recebido_em', { ascending: true })
      .limit(200),
    supabase.from('venda_integracao_pedidos').select('recebido_em').eq('loja_id', loja.id).order('recebido_em', { ascending: true }).limit(1).maybeSingle<{ recebido_em: string }>(),
    supabase.from('venda_integracao_pedidos').select('recebido_em').eq('loja_id', loja.id).order('recebido_em', { ascending: false }).limit(1).maybeSingle<{ recebido_em: string }>(),
  ])
  const erro = linhas.error ?? primeiro.error ?? ultimo.error
  if (erro) {
    console.error('integracao/ordem-producao/status:', erro.message)
    return NextResponse.json(
      { error: ehTabelaAusente(erro) ? 'Registro de pedidos ainda não ativado no Estoque' : 'Falha ao consultar o registro de pedidos' },
      { status: 503 }
    )
  }

  return NextResponse.json(
    montarStatusPedido(pedidoRef, (linhas.data ?? []) as LinhaRegistroPedido[], {
      primeiro: primeiro.data?.recebido_em ?? null,
      ultimo: ultimo.data?.recebido_em ?? null,
    })
  )
}
