import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import {
  ContagemTransferenciaPDF,
  type ContagemTransferenciaItem,
} from '@/components/relatorio/ContagemTransferenciaPDF'
import { formatarNomeProduto } from '@/lib/formatar-nome'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select('id, data, codigo_local_origem, codigo_local_destino')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!trans) {
    return NextResponse.json({ error: 'Transferência não encontrada' }, { status: 404 })
  }

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .in('codigo_local_estoque', [trans.codigo_local_origem, trans.codigo_local_destino])
  const localMap = new Map(
    (locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao])
  )

  const { data: movimentos } = await supabase
    .from('movimentos')
    .select('id_prod, quan, status')
    .eq('transferencia_id', id)
    .order('id')

  const codigos = [...new Set((movimentos ?? []).map((m) => m.id_prod))]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, codigo, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }
  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  const itens: ContagemTransferenciaItem[] = (movimentos ?? []).map((m) => {
    const p = prodMap.get(m.id_prod)
    return {
      codigo: p?.codigo || String(m.id_prod),
      descricao: formatarNomeProduto(p?.descricao) || `Produto ${m.id_prod}`,
      unidade: p?.unidade || '',
      quan: m.quan != null ? String(m.quan) : '-',
      status: m.status || 'N/A',
    }
  })

  const element = createElement(ContagemTransferenciaPDF, {
    loja: loja?.nome_fantasia || loja?.nome || '',
    data: new Date(trans.data).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' }),
    // So o NOME do local (sem o codigo numerico): pedido da reuniao 16/06
    // "tirar os numeros, deixar so o local". Fallback no codigo se faltar nome.
    origem: localMap.get(trans.codigo_local_origem) || String(trans.codigo_local_origem),
    destino: localMap.get(trans.codigo_local_destino) || String(trans.codigo_local_destino),
    itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="transferencia-${trans.id}.pdf"`,
    },
  })
}
