import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { EtiquetaProdutoPDF, type EtiquetaItem } from '@/components/etiqueta/EtiquetaProdutoPDF'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: itens } = await supabase
    .from('nota_fiscal_items')
    .select('c_codigo_produto, c_descricao_produto, c_unidade_nfe, quantidade')
    .eq('nota_fiscal_id', id)
    .eq('loja_id', lojaId)
    .not('quantidade', 'is', null)
    .gt('quantidade', 0)
    .order('n_sequencia')

  if (!itens?.length) {
    return NextResponse.json(
      { error: 'Nenhum item com quantidade definida para etiqueta' },
      { status: 404 }
    )
  }

  // Uma etiqueta por unidade de quantidade (igual ao Laravel)
  const etiquetas: EtiquetaItem[] = []
  for (const item of itens) {
    const qtd = item.quantidade ?? 1
    for (let n = 1; n <= qtd; n++) {
      etiquetas.push({
        descricao: item.c_descricao_produto ?? '',
        quantidade: 1,
        unidade: item.c_unidade_nfe ?? 'UN',
        codigo: item.c_codigo_produto ?? undefined,
        index: n,
        total: qtd,
      })
    }
  }

  const element = createElement(EtiquetaProdutoPDF, { itens: etiquetas }) as Parameters<
    typeof renderToBuffer
  >[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="etiquetas-nf-${id}.pdf"`,
    },
  })
}
