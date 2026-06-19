import { NextResponse } from 'next/server'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { RelatorioOPPDF, type RelatorioOPItem } from '@/components/relatorio/RelatorioOPPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { isOpConcluida } from '@/lib/op-status'
import { numBRPdf } from '@/lib/pdf-utils'

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

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) {
    return pdfErroResponse('Sem permissão', 'Você não tem permissão para acessar este relatório.')
  }

  const { searchParams } = new URL(request.url)
  const opProduto = searchParams.get('op_produto') || ''
  const ordemProducao = searchParams.get('ordem_producao') || ''
  const statusFiltro = searchParams.get('status') || ''

  const supabase = await createClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  const nomeLoja = loja?.nome_fantasia || loja?.nome || 'Loja'

  let codigosFiltro: number[] | null = null
  if (opProduto) {
    const termo = escapeIlikeOr(opProduto)
    const { data: prods } = await supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', lojaId)
      .or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
    codigosFiltro = [
      ...new Set((prods ?? []).map((p) => p.codigo_produto).filter((v): v is number => v != null)),
    ]
  }

  const PAGE_SIZE = 1000
  const ordensList: NonNullable<Awaited<ReturnType<typeof buildQuery>>['data']> = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('ordens_producao')
      .select(
        'num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, produto_descricao, produto_unidade, validade, concluida',
      )
      .eq('loja_id', lojaId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
    if (ordemProducao) q = q.eq('num_ordem', ordemProducao)
    if (codigosFiltro !== null) {
      q = q.in('identificacao_n_cod_produto', codigosFiltro.length ? codigosFiltro : [-1])
    }
    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    ordensList.push(...bloco)
    if (bloco.length < PAGE_SIZE) break
  }

  // Resolve descricoes dos produtos quando produto_descricao estiver vazio.
  const codigos = [
    ...new Set(
      ordensList
        .filter((o) => !o.produto_descricao)
        .map((o) => o.identificacao_n_cod_produto)
        .filter(Boolean),
    ),
  ]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, descricao')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }
  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p.descricao]))

  let itens: RelatorioOPItem[] = ordensList.map((o) => {
    const concluida = isOpConcluida(o)
    return {
      numOP: o.identificacao_c_num_op || o.num_ordem || '-',
      produto:
        formatarNomeProduto(
          o.produto_descricao || prodMap.get(o.identificacao_n_cod_produto),
        ) || `Produto ${o.identificacao_n_cod_produto}`,
      quantidade: `${numBRPdf(o.identificacao_n_qtde)} ${o.produto_unidade || ''}`.trim(),
      validade: o.validade || '-',
      status: concluida ? 'Concluída' : 'Pendente',
    }
  })

  // Filtro de status apos montar os itens (usa logica isOpConcluida).
  if (statusFiltro === 'concluida') itens = itens.filter((i) => i.status === 'Concluída')
  else if (statusFiltro === 'pendente') itens = itens.filter((i) => i.status === 'Pendente')

  // Monta subtitulo com filtros aplicados.
  const filtrosAtivos: string[] = []
  if (ordemProducao) filtrosAtivos.push(`OP: ${ordemProducao}`)
  if (opProduto) filtrosAtivos.push(`Produto: ${opProduto}`)
  if (statusFiltro) filtrosAtivos.push(`Status: ${statusFiltro}`)

  const filtros = filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined
  const periodo = `${itens.length} ${itens.length === 1 ? 'ordem' : 'ordens'}`

  const nomeArquivo = `relatorio-op-${nomeLoja.replace(/\s+/g, '-').toLowerCase()}.pdf`

  const element = createElement(RelatorioOPPDF, {
    loja: nomeLoja,
    periodo,
    filtros,
    ordens: itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nomeArquivo}"`,
    },
  })
}
