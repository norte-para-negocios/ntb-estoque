import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { RelatorioNFPDF, type RelatorioNFItem } from '@/components/relatorio/RelatorioNFPDF'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
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

  const supabase = await createClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  // Paginacao interna: PostgREST limita a 1000 linhas por request. Buscamos
  // em paginas ate esgotar para nao truncar silenciosamente o relatorio.
  const PAGE_SIZE = 1000
  const notas: NonNullable<Awaited<ReturnType<typeof buildQuery>>['data']> = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('notas_fiscais')
      .select('d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe')
      .eq('loja_id', lojaId)
      .gte('d_emissao_nfe', dataInicio)
      .lte('d_emissao_nfe', dataFinal)
      .is('deleted_at', null)
      .order('d_emissao_nfe', { ascending: true })
      .range(from, to)
    if (numNfe) q = q.ilike('c_numero_nfe', `%${numNfe}%`)
    if (fornecedor) q = q.ilike('c_razao_social', `%${fornecedor}%`)
    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    notas.push(...bloco)
    if (bloco.length < PAGE_SIZE) break
  }

  const itens: RelatorioNFItem[] = (notas ?? []).map((n) => ({
    emissao: fmtData(n.d_emissao_nfe),
    numero: String(n.c_numero_nfe ?? '-'),
    fornecedor: n.c_razao_social || n.c_nome || '-',
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
