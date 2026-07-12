import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { fmtData } from '@/lib/pdf-utils'
import { RelatorioNFPDF, type RelatorioNFItem } from '@/components/relatorio/RelatorioNFPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { labelTipoItem } from '@/lib/constants-omie'
import { complementarNotasFiscais, limiteJanelaQuente } from '@/lib/historico-contabo'

function labelEtapa(etapa: string | null): string {
  return etapa === '60' ? 'Concluída' : 'Pendente'
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

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) {
    return pdfErroResponse('Sem permissão', 'Você não tem permissão para acessar este relatório.')
  }

  const { searchParams } = new URL(request.url)
  const dataInicio =
    searchParams.get('data_inicio') ||
    new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = searchParams.get('data_final') || new Date().toISOString().split('T')[0]
  const fornecedor = searchParams.get('fornecedor') || ''
  const numNfe = searchParams.get('num_nfe') || ''
  const status = searchParams.get('status') || ''
  // tipo vem como lista separada por virgula (multi-select) na URL.
  const tipo = searchParams.get('tipo') || ''
  const tiposArr = valoresMulti(tipo)
  const produto = searchParams.get('produto') || ''

  const supabase = await createClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  const nomeLoja = loja?.nome_fantasia || loja?.nome || 'Loja'

  // Mesma logica de filtro da tela/export.
  let notaIdsFiltro: number[] | null = null
  if (tiposArr.length || produto) {
    if (tiposArr.length) {
      const { data: prodCodigos } = await supabase
        .from('produtos')
        .select('codigo_produto')
        .eq('loja_id', lojaId)
        .in('tipo_item', tiposArr)
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
          new Set(
            (itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v): v is number => v != null),
          ),
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
        new Set(
          (itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v): v is number => v != null),
        ),
      )
      notaIdsFiltro = notaIds.length ? notaIds : [-1]
    }
  }

  const PAGE_SIZE = 1000
  type Nota = {
    id: number
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

  const notasCompletas = dataInicio < limiteJanelaQuente()
    ? await complementarNotasFiscais(notas, { lojaId, dataInicio, dataFinal, busca: numNfe || fornecedor })
    : notas

  const itens: RelatorioNFItem[] = notasCompletas.map((n) => ({
    emissao: fmtData(n.d_emissao_nfe),
    numero: String(n.c_numero_nfe ?? '-'),
    fornecedor: n.c_razao_social || n.c_nome || '-',
    etapa: labelEtapa(n.c_etapa),
    valor: n.n_valor_nfe ?? 0,
  }))

  // Monta subtitulo com filtros aplicados.
  const filtrosAtivos: string[] = []
  if (fornecedor) filtrosAtivos.push(`Fornecedor: ${fornecedor}`)
  if (numNfe) filtrosAtivos.push(`NF: ${numNfe}`)
  if (status) filtrosAtivos.push(`Status: ${status === 'C' ? 'Concluída' : 'Pendente'}`)
  if (tiposArr.length) filtrosAtivos.push(`Tipo: ${tiposArr.map((t) => labelTipoItem(t)).join(', ')}`)
  if (produto) filtrosAtivos.push(`Produto: ${produto}`)

  const periodo = `${fmtData(dataInicio)} a ${fmtData(dataFinal)}`
  const filtros = filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined

  const nomeArquivo = `relatorio-nf-${nomeLoja.replace(/\s+/g, '-').toLowerCase()}-${dataInicio}-${dataFinal}.pdf`

  const element = createElement(RelatorioNFPDF, {
    loja: nomeLoja,
    periodo,
    filtros,
    notas: itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nomeArquivo}"`,
    },
  })
}
