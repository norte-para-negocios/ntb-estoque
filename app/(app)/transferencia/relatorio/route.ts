import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import {
  RelatorioTransferenciaPDF,
  type RelatorioTransferenciaItem,
} from '@/components/relatorio/RelatorioTransferenciaPDF'

function fmtData(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('pt-BR')
}

function fmtDataParam(d: string): string {
  const [y, m, day] = d.split('-')
  if (!y || !m || !day) return d
  return `${day}/${m}/${y}`
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const dataInicio =
    searchParams.get('data_inicio') ||
    new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = searchParams.get('data_final') || new Date().toISOString().split('T')[0]
  const familia = searchParams.get('familia') || ''
  const tipo = searchParams.get('tipo') || ''

  const supabase = await createClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  // Filtro de familia/tipo via produtos -> movimentos -> transferencia_id
  // (mesma logica da pagina de transferencias).
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
          (movs ?? []).map((m) => m.transferencia_id).filter((v): v is number => v != null)
        ),
      ]
    } else {
      idsFiltrados = []
    }
  }

  // Paginacao interna: PostgREST limita a 1000 linhas por request. Buscamos
  // em paginas ate esgotar para nao truncar o relatorio.
  const PAGE_SIZE = 1000
  type Linha = {
    id: number
    data: string | null
    codigo_local_origem: string | null
    codigo_local_destino: string | null
    status: string | null
    movimentos: { count: number }[]
  }
  const transferencias: Linha[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('transferencias')
      .select('id, data, codigo_local_origem, codigo_local_destino, status, movimentos(count)')
      .eq('loja_id', lojaId)
      .gte('data', dataInicio)
      .lte('data', `${dataFinal}T23:59:59`)
      .order('data', { ascending: false })
      .range(from, to)
    if (idsFiltrados !== null) q = q.in('id', idsFiltrados.length ? idsFiltrados : [-1])
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
    produtos: Array.isArray(t.movimentos) ? t.movimentos[0]?.count ?? 0 : 0,
    status: t.status || 'N/A',
  }))

  const periodo = `${fmtDataParam(dataInicio)} a ${fmtDataParam(dataFinal)}`
  const element = createElement(RelatorioTransferenciaPDF, {
    loja: loja?.nome_fantasia || loja?.nome || '',
    periodo,
    transferencias: itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="relatorio-transferencias.pdf"',
    },
  })
}
