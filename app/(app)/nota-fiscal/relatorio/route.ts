import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { RelatorioNFPDF, type RelatorioNFItem } from '@/components/relatorio/RelatorioNFPDF'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function labelEtapa(etapa: string | null): string {
  return etapa === '60' ? 'Concluída' : 'Pendente'
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const dataInicio =
    searchParams.get('data_inicio') ||
    new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = searchParams.get('data_final') || new Date().toISOString().split('T')[0]
  const fornecedor = searchParams.get('fornecedor') || ''
  const numNfe = searchParams.get('num_nfe') || ''
  const status = searchParams.get('status') || ''
  const tipo = searchParams.get('tipo') || ''
  const produto = searchParams.get('produto') || ''

  const supabase = await createClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  // Mesma logica de filtro da tela/export: resolve notaIds quando ha filtro de
  // tipo (via produtos.tipo_item) ou produto (via descricao/codigo do item). Sem
  // isto o PDF saia diferente da tela quando o usuario filtrava por tipo/produto.
  let notaIdsFiltro: number[] | null = null
  if (tipo || produto) {
    if (tipo) {
      const { data: prodCodigos } = await supabase
        .from('produtos')
        .select('codigo_produto')
        .eq('loja_id', lojaId)
        .eq('tipo_item', tipo)
      const codigos = (prodCodigos ?? []).map((p) => String(p.codigo_produto))
      if (codigos.length === 0) {
        notaIdsFiltro = [-1]
      } else {
        let itemQuery = supabase
          .from('nota_fiscal_items')
          .select('nota_fiscal_id')
          .eq('loja_id', lojaId)
          .in('produto_codigo', codigos)
        if (produto) {
          const p = escapeIlikeOr(produto)
          itemQuery = itemQuery.or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
        }
        const { data: itemRows } = await itemQuery
        const notaIds = Array.from(
          new Set((itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v): v is number => v != null)),
        )
        notaIdsFiltro = notaIds.length ? notaIds : [-1]
      }
    } else if (produto) {
      const p = escapeIlikeOr(produto)
      const { data: itemRows } = await supabase
        .from('nota_fiscal_items')
        .select('nota_fiscal_id')
        .eq('loja_id', lojaId)
        .or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
      const notaIds = Array.from(
        new Set((itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v): v is number => v != null)),
      )
      notaIdsFiltro = notaIds.length ? notaIds : [-1]
    }
  }

  // Paginacao interna: PostgREST limita a 1000 linhas por request. Buscamos
  // em paginas ate esgotar para nao truncar silenciosamente o relatorio.
  const PAGE_SIZE = 1000
  type Nota = {
    d_emissao_nfe: string | null
    c_numero_nfe: string | null
    c_razao_social: string | null
    c_nome: string | null
    n_valor_nfe: number | null
    c_etapa: string | null
  }
  const notas: Nota[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('notas_fiscais')
      .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa')
      .eq('loja_id', lojaId)
      .gte('d_emissao_nfe', dataInicio)
      .lte('d_emissao_nfe', dataFinal)
      .is('deleted_at', null)
      .order('d_emissao_nfe', { ascending: true })
      .range(from, to)
    if (numNfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(numNfe)}%`)
    if (fornecedor) q = q.ilike('c_nome', `%${escapeIlike(fornecedor)}%`)
    if (status === 'C') q = q.eq('c_etapa', '60')
    else if (status === 'P') q = q.neq('c_etapa', '60')
    if (notaIdsFiltro !== null) q = q.in('id', notaIdsFiltro)
    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    notas.push(...(bloco as Nota[]))
    if (bloco.length < PAGE_SIZE) break
  }

  const itens: RelatorioNFItem[] = notas.map((n) => ({
    emissao: fmtData(n.d_emissao_nfe),
    numero: String(n.c_numero_nfe ?? '-'),
    fornecedor: n.c_razao_social || n.c_nome || '-',
    etapa: labelEtapa(n.c_etapa),
    valor: n.n_valor_nfe ?? 0,
  }))

  const periodo = `${fmtData(dataInicio)} a ${fmtData(dataFinal)}`
  const element = createElement(RelatorioNFPDF, {
    loja: loja?.nome_fantasia || loja?.nome || '',
    periodo,
    notas: itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="relatorio-notas-fiscais.pdf"',
    },
  })
}
