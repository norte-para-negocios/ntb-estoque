import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { EtiquetaOPPDF, type EtiquetaOPItem } from '@/components/etiqueta/EtiquetaOPPDF'

function fmtData(d: string | null): string | undefined {
  if (!d) return undefined
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: op } = await supabase
    .from('ordens_producao')
    .select(
      'identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, validade, quantidade, identificacao_n_qtde'
    )
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!op) {
    return NextResponse.json({ error: 'Ordem nao encontrada' }, { status: 404 })
  }

  const { data: prod } = await supabase
    .from('produtos')
    .select('descricao, unidade')
    .eq('loja_id', lojaId)
    .eq('codigo_produto', op.identificacao_n_cod_produto)
    .maybeSingle()

  const total = op.quantidade ?? op.identificacao_n_qtde ?? 1
  const etiquetas: EtiquetaOPItem[] = []
  for (let n = 1; n <= total; n++) {
    etiquetas.push({
      produto: prod?.descricao || `Produto ${op.identificacao_n_cod_produto}`,
      numOP: op.identificacao_c_num_op || op.num_ordem || '-',
      quantidade: 1,
      unidade: prod?.unidade || 'UN',
      validade: fmtData(op.validade),
      index: n,
      total,
    })
  }

  const element = createElement(EtiquetaOPPDF, { itens: etiquetas }) as Parameters<
    typeof renderToBuffer
  >[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="etiquetas-op-${id}.pdf"`,
    },
  })
}
