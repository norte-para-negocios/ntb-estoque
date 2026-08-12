import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Sertão Teste (2026-08-12) -- ver docs/superpowers/specs/
// 2026-08-12-sertao-teste-integracao-isolada-design.md (repo NTB
// Vendas). Espelha a forma de entrada de app/api/integracao/
// ordem-producao/route.ts, mas NUNCA chama a Omie -- grava só na
// tabela isolada ordens_producao_teste. Regra de ouro: esta rota não
// pode importar lib/omie/ordem-producao.ts nem lib/omie/client.ts.

interface ItemPedido {
  codigo: string
  quantidade: number
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { itens?: ItemPedido[]; pedidoRef?: string } | null
  if (!body?.itens?.length) {
    return NextResponse.json({ error: 'Informe itens: [{ codigo, quantidade }]' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id')
    .eq('integracao_teste_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<{ id: number }>()

  if (!loja) {
    return NextResponse.json({ error: 'Chave de integração de teste inválida' }, { status: 401 })
  }

  const resultados: { codigo: string; ok: boolean; erro?: string }[] = []

  for (const item of body.itens) {
    if (!item?.codigo || !item.quantidade || item.quantidade <= 0) {
      resultados.push({ codigo: item?.codigo ?? '?', ok: false, erro: 'Item inválido' })
      continue
    }

    const { data: produto } = await supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', loja.id)
      .eq('codigo', item.codigo)
      .maybeSingle<{ codigo_produto: number }>()

    const { error } = await supabase.from('ordens_producao_teste').insert({
      loja_id: loja.id,
      codigo_produto: produto?.codigo_produto ?? null,
      codigo_produto_texto: item.codigo,
      quantidade: item.quantidade,
      pedido_ref: body.pedidoRef ?? null,
    })

    if (error) {
      resultados.push({ codigo: item.codigo, ok: false, erro: error.message })
    } else {
      resultados.push({ codigo: item.codigo, ok: true })
    }
  }

  return NextResponse.json({ lojaId: loja.id, teste: true, resultados })
}
