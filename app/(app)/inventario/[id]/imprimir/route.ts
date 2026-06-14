import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import {
  ContagemInventarioPDF,
  type ContagemInventarioItem,
} from '@/components/relatorio/ContagemInventarioPDF'

const TIPO_MOVIMENTO_INVENTARIO: Record<string, string> = {
  INV: 'Ajuste por Inventário',
  INI: 'Ajuste por Inventário (Estoque Inicial)',
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: inventario } = await supabase
    .from('inventarios')
    .select('id, data, codigo_local_estoque, motivo')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!inventario) {
    return NextResponse.json({ error: 'Inventário não encontrado' }, { status: 404 })
  }

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  const { data: local } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .eq('codigo_local_estoque', inventario.codigo_local_estoque)
    .maybeSingle()

  const { data: itensRaw } = await supabase
    .from('inventario_items')
    .select('produto_codigo, produto_codigo_produto, produto_descricao, quan, status')
    .eq('inventario_id', id)
    .gte('quan', 0)
    .order('id')

  // Unidade vem do cadastro de produtos
  const codigos = [
    ...new Set((itensRaw ?? []).map((i) => i.produto_codigo_produto).filter(Boolean)),
  ]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }
  const unidadeMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p.unidade]))

  const itens: ContagemInventarioItem[] = (itensRaw ?? []).map((it) => ({
    codigo: it.produto_codigo || '',
    descricao: it.produto_descricao || '',
    unidade: unidadeMap.get(it.produto_codigo_produto) || '',
    quan: Number(it.quan ?? 0),
    status: it.status || 'N/A',
  }))

  const element = createElement(ContagemInventarioPDF, {
    id: inventario.id,
    loja: loja?.nome_fantasia || loja?.nome || '',
    data: new Date(inventario.data).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' }),
    local: `${local?.codigo_local_estoque ?? inventario.codigo_local_estoque} - ${local?.descricao ?? ''}`,
    tipo: TIPO_MOVIMENTO_INVENTARIO[inventario.motivo ?? ''] || 'Desconhecido',
    itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="inventario-${inventario.id}.pdf"`,
    },
  })
}
