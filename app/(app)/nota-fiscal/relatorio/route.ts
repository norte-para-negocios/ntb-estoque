import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlike, escapeIlikeOr, buscarTudoPaginado } from '@/lib/utils-busca'
import { fmtData } from '@/lib/pdf-utils'
import { RelatorioNFPDF, type RelatorioNFItem } from '@/components/relatorio/RelatorioNFPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { labelTipoItem } from '@/lib/constants-omie'
import { complementarNotasFiscais, limiteJanelaQuente } from '@/lib/historico-contabo'
import { statusNF, NAO_CANCELADA_OR, statusBateFiltro } from '@/lib/nf-status'

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
      // Paginado: produtos.tipo_item pode passar de 1000 linhas numa unica loja
      // (ex: loja 6, tipo "99" tem 1143) -- sem .range() o PostgREST trunca em
      // silencio e o relatorio some com notas validas.
      const prodCodigos = await buscarTudoPaginado<{ codigo_produto: string | number }>((from, to) =>
        supabase
          .from('produtos')
          .select('codigo_produto')
          .eq('loja_id', lojaId)
          .in('tipo_item', tiposArr)
          .range(from, to),
      )
      const codigos = prodCodigos.map((p) => String(p.codigo_produto))
      if (codigos.length === 0) {
        notaIdsFiltro = [-1]
      } else {
        // Paginado: nota_fiscal_items facilmente passa de 1000 linhas por loja
        // (toda loja ativa ja passa disso) -- mesma razao acima.
        const itemRows = await buscarTudoPaginado<{ nota_fiscal_id: number | null }>((from, to) => {
          let q = supabase
            .from('nota_fiscal_items')
            .select('nota_fiscal_id')
            .eq('loja_id', lojaId)
            .in('produto_codigo', codigos)
            .range(from, to)
          if (produto) {
            const p = escapeIlikeOr(produto)
            q = q.or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
          }
          return q
        })
        const notaIds = Array.from(
          new Set(itemRows.map((r) => r.nota_fiscal_id).filter((v): v is number => v != null)),
        )
        notaIdsFiltro = notaIds.length ? notaIds : [-1]
      }
    } else if (produto) {
      const p = escapeIlikeOr(produto)
      const itemRows = await buscarTudoPaginado<{ nota_fiscal_id: number | null }>((from, to) =>
        supabase
          .from('nota_fiscal_items')
          .select('nota_fiscal_id')
          .eq('loja_id', lojaId)
          .or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
          .range(from, to),
      )
      const notaIds = Array.from(
        new Set(itemRows.map((r) => r.nota_fiscal_id).filter((v): v is number => v != null)),
      )
      notaIdsFiltro = notaIds.length ? notaIds : [-1]
    }
  }

  const PAGE_SIZE = 1000
  type Nota = {
    id: number
    n_id_receb: string
    d_emissao_nfe: string | null
    c_numero_nfe: string | null
    c_razao_social: string | null
    c_nome: string | null
    n_valor_nfe: number | null
    c_etapa: string | null
    full_object: unknown
  }
  const notas: Nota[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('notas_fiscais')
      .select('id, n_id_receb, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, full_object')
      .eq('loja_id', lojaId)
      .gte('d_emissao_nfe', dataInicio)
      .lte('d_emissao_nfe', dataFinal)
      .is('deleted_at', null)
      // d_emissao_nfe se repete (varias notas no mesmo dia) -- sem um desempate
      // unico, paginar em blocos de 1000 pode duplicar ou pular linhas no
      // limite entre blocos (mesmo risco do resto do fix desta auditoria).
      .order('d_emissao_nfe', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    if (numNfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(numNfe)}%`)
    if (fornecedor) q = q.ilike('c_nome', `%${escapeIlike(fornecedor)}%`)
    if (status === 'C' || status === 'CONCLUIDA') q = q.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (status === 'P' || status === 'PENDENTE') q = q.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (status === 'CANCELADA') q = q.eq('full_object->infoCadastro->>cCancelada', 'S')
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

  // complementarNotasFiscais busca a fatia fria so por loja/data/busca -- nao
  // conhece o filtro de tipo/produto (limitacao documentada no AGENTS.md).
  // Sem filtrar aqui, toda nota fria do periodo entraria no relatorio mesmo
  // sem casar com o filtro, quando o periodo cruza os 90 dias.
  const notasCompletasBrutas = dataInicio < limiteJanelaQuente()
    ? await complementarNotasFiscais(notas, {
        lojaId,
        dataInicio,
        dataFinal,
        busca: numNfe || fornecedor,
        filtrarFrias: status ? (n) => statusBateFiltro(n, status) : undefined,
      })
    : notas
  const notaIdsFiltroSet = notaIdsFiltro ? new Set(notaIdsFiltro) : null
  const notasCompletas = notaIdsFiltroSet
    ? notasCompletasBrutas.filter((n) => notaIdsFiltroSet.has(n.id))
    : notasCompletasBrutas

  const itens: RelatorioNFItem[] = notasCompletas.map((n) => ({
    emissao: fmtData(n.d_emissao_nfe),
    numero: String(n.c_numero_nfe ?? '-'),
    fornecedor: n.c_razao_social || n.c_nome || '-',
    etapa: statusNF(n.c_etapa, n.full_object).label,
    valor: n.n_valor_nfe ?? 0,
  }))

  // Monta subtitulo com filtros aplicados.
  const filtrosAtivos: string[] = []
  if (fornecedor) filtrosAtivos.push(`Fornecedor: ${fornecedor}`)
  if (numNfe) filtrosAtivos.push(`NF: ${numNfe}`)
  if (status) filtrosAtivos.push(`Status: ${status === 'C' || status === 'CONCLUIDA' ? 'Concluída' : status === 'CANCELADA' ? 'Cancelada' : 'Pendente'}`)
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
