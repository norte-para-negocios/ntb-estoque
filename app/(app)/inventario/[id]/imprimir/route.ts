import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import {
  ContagemInventarioPDF,
  type ContagemInventarioItem,
} from '@/components/relatorio/ContagemInventarioPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'
import { formatarNomeProduto } from '@/lib/formatar-nome'

const TIPO_MOVIMENTO_INVENTARIO: Record<string, string> = {
  INV: 'Ajuste por Inventário',
  INI: 'Ajuste por Inventário (Estoque Inicial)',
}

async function pdfErroResponse(titulo: string, mensagem: string) {
  const el = createElement(PdfErro, { titulo, mensagem }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="erro.pdf"',
    },
  })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) {
    return pdfErroResponse('Sem permissão', 'Você não tem permissão para acessar este relatório.')
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
    return pdfErroResponse('Inventário não encontrado', `O inventário #${id} não foi encontrado ou não pertence a esta loja.`)
  }

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  const nomeLoja = loja?.nome_fantasia || loja?.nome || ''

  // Busca o NOME do local (pedido da reuniao 16/06: so nome, sem codigo numerico).
  const { data: local } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .eq('codigo_local_estoque', inventario.codigo_local_estoque)
    .maybeSingle()

  // So o nome do local (descricao), sem exibir o codigo numerico.
  const nomeLocal = local?.descricao || inventario.codigo_local_estoque || '-'

  // PostgREST corta em 1000 linhas por padrao e sem erro: inventarios podem ter
  // mais itens que isso (uma loja chega a ~2000 produtos ativos), entao pagina
  // com .range() ate esgotar - senao o PDF impresso sai com itens faltando e o
  // total de quantidade some silenciosamente (achado do audit de 2026-07-18).
  const itensRaw: {
    produto_codigo: string | null
    produto_codigo_produto: number
    produto_descricao: string
    quan: number | null
    status: string | null
  }[] = []
  const PAGE_SIZE = 1000
  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await supabase
      .from('inventario_items')
      .select('produto_codigo, produto_codigo_produto, produto_descricao, quan, status')
      .eq('inventario_id', id)
      .gte('quan', 0)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    itensRaw.push(...bloco)
    if (bloco.length < PAGE_SIZE) break
  }

  const codigos = [
    ...new Set((itensRaw ?? []).map((i) => i.produto_codigo_produto).filter(Boolean)),
  ]
  // Achado real (auditoria de relatórios, 2026-07-26): mesmo fix de
  // app/(app)/inventario/[id]/contagem/page.tsx -- um único `.in()` sem
  // paginação cai no teto padrão de 1000 linhas do PostgREST.
  const produtos: { codigo_produto: number; unidade: string | null }[] = []
  for (let from = 0; codigos.length && from < codigos.length; from += 1000) {
    const { data } = await supabase
      .from('produtos')
      .select('codigo_produto, unidade')
      .eq('loja_id', lojaId)
      .in('codigo_produto', codigos.slice(from, from + 1000))
    if (data?.length) produtos.push(...data)
  }
  const unidadeMap = new Map(produtos.map((p) => [p.codigo_produto, p.unidade]))

  const itens: ContagemInventarioItem[] = (itensRaw ?? []).map((it) => ({
    codigo: it.produto_codigo || '',
    descricao: formatarNomeProduto(it.produto_descricao),
    unidade: unidadeMap.get(it.produto_codigo_produto) || '',
    quan: Number(it.quan ?? 0),
    status: it.status || 'N/A',
  }))

  const dataFormatada = new Date(inventario.data).toLocaleDateString('pt-BR', {
    timeZone: 'America/Bahia',
  })

  const element = createElement(ContagemInventarioPDF, {
    id: inventario.id,
    loja: nomeLoja,
    data: dataFormatada,
    local: nomeLocal,
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
