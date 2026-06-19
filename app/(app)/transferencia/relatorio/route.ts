import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { fmtData, fmtDataParam } from '@/lib/pdf-utils'
import {
  RelatorioTransferenciaPDF,
  type RelatorioTransferenciaItem,
} from '@/components/relatorio/RelatorioTransferenciaPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'

// Mapa de motivo (TRF/TPQ) para texto legivel no PDF.
const LABEL_MOTIVO: Record<string, string> = {
  TRF: 'Transferencia',
  TPQ: 'Transferencia PQ',
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
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) {
    return pdfErroResponse('Sem permissao', 'Voce nao tem permissao para acessar este relatorio.')
  }

  const { searchParams } = new URL(request.url)
  const dataInicio =
    searchParams.get('data_inicio') ||
    new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = searchParams.get('data_final') || new Date().toISOString().split('T')[0]
  const familia = searchParams.get('familia') || ''
  const tipo = searchParams.get('tipo') || ''
  const status = searchParams.get('status') || ''

  const supabase = await createClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  const nomeLoja = loja?.nome_fantasia || loja?.nome || 'Loja'

  // Filtro de familia/tipo via produtos -> movimentos -> transferencia_id.
  let idsFiltrados: number[] | null = null
  if (familia || tipo) {
    let prodQuery = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    if (familia) prodQuery = prodQuery.eq('descricao_familia', familia)
    if (tipo) prodQuery = prodQuery.eq('tipo_item', tipo)
    const { data: prods } = await prodQuery
    const codigos = [...new Set((prods ?? []).map((p) => p.codigo_produto).filter(Boolean))]

    if (codigos.length) {
      const { data: movs } = await supabase
        .from('movimentos')
        .select('transferencia_id')
        .eq('loja_id', lojaId)
        .in('id_prod', codigos)
        .not('transferencia_id', 'is', null)
      idsFiltrados = [
        ...new Set(
          (movs ?? []).map((m) => m.transferencia_id).filter((v): v is number => v != null),
        ),
      ]
    } else {
      idsFiltrados = []
    }
  }

  const PAGE_SIZE = 1000
  type Linha = {
    id: number
    data: string | null
    codigo_local_origem: string | null
    codigo_local_destino: string | null
    motivo: string | null
    status: string | null
    movimentos: { count: number }[]
  }
  const transferencias: Linha[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('transferencias')
      .select('id, data, codigo_local_origem, codigo_local_destino, motivo, status, movimentos(count)')
      .eq('loja_id', lojaId)
      .gte('data', dataInicio)
      .lte('data', `${dataFinal}T23:59:59`)
      .order('data', { ascending: false })
      .range(from, to)
    if (idsFiltrados !== null) q = q.in('id', idsFiltrados.length ? idsFiltrados : [-1])
    if (status) q = q.eq('status', status)
    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    transferencias.push(...(bloco as Linha[]))
    if (bloco.length < PAGE_SIZE) break
  }

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  const itens: RelatorioTransferenciaItem[] = transferencias.map((t) => ({
    data: fmtData(t.data),
    origem: localMap.get(t.codigo_local_origem ?? '') || t.codigo_local_origem || '-',
    destino: localMap.get(t.codigo_local_destino ?? '') || t.codigo_local_destino || '-',
    motivo: t.motivo ? (LABEL_MOTIVO[t.motivo] ?? t.motivo) : undefined,
    produtos: Array.isArray(t.movimentos) ? t.movimentos[0]?.count ?? 0 : 0,
    status: t.status || 'N/A',
  }))

  // Monta subtitulo com filtros aplicados.
  const filtrosAtivos: string[] = []
  if (familia) filtrosAtivos.push(`Familia: ${familia}`)
  if (tipo) filtrosAtivos.push(`Tipo: ${tipo}`)
  if (status) filtrosAtivos.push(`Status: ${status}`)

  const periodo = `${fmtDataParam(dataInicio)} a ${fmtDataParam(dataFinal)}`
  const filtros = filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined

  // Nome do arquivo inclui loja e periodo.
  const nomeArquivo = `relatorio-transferencias-${nomeLoja.replace(/\s+/g, '-').toLowerCase()}-${dataInicio}-${dataFinal}.pdf`

  const element = createElement(RelatorioTransferenciaPDF, {
    loja: nomeLoja,
    periodo,
    filtros,
    transferencias: itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nomeArquivo}"`,
    },
  })
}
