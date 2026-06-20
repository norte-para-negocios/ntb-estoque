import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { carregarResumoDia, hojeBahia } from '@/lib/resumo-dia'
import { ResumoDiaPDF } from '@/components/relatorio/ResumoDiaPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'

async function pdfErro(titulo: string, mensagem: string) {
  const el = createElement(PdfErro, { titulo, mensagem }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="erro.pdf"' },
  })
}

export async function GET(request: Request) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) {
    return pdfErro('Sem permissão', 'Você não tem permissão para acessar este relatório.')
  }

  const { searchParams } = new URL(request.url)
  const hoje = hojeBahia()
  const dataParam = searchParams.get('data') || ''
  const data = /^\d{4}-\d{2}-\d{2}$/.test(dataParam) && dataParam <= hoje ? dataParam : hoje

  const lojaParam = searchParams.get('loja')
  const lojaSel = lojaParam && ator.lojaIds.includes(Number(lojaParam)) ? Number(lojaParam) : null
  const lojaIdsEfetivos = lojaSel ? [lojaSel] : ator.lojaIds

  // Nome da loja para o cabecalho.
  let nomeLoja = 'Todas as lojas'
  if (lojaSel) {
    const supabase = createServiceClient()
    const { data: loja } = await supabase.from('lojas').select('nome, nome_fantasia').eq('id', lojaSel).single()
    nomeLoja = loja?.nome_fantasia || loja?.nome || `Loja ${lojaSel}`
  }

  const { kpis, feed } = await carregarResumoDia(lojaIdsEfetivos, data)
  const [y, m, d] = data.split('-')
  const dataBR = `${d}/${m}/${y}`

  const element = createElement(ResumoDiaPDF, { loja: nomeLoja, dataBR, kpis, feed }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)
  const nomeArquivo = `resumo-${nomeLoja.replace(/\s+/g, '-').toLowerCase()}-${data}.pdf`

  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nomeArquivo}"` },
  })
}
