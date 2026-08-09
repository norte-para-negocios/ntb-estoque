import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { carregarResumoDiaCompleto, hojeBahia, janelaPeriodoBahia, type PeriodoResumo } from '@/lib/resumo-dia'
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
  if (!ator.podeGerir) return pdfErro('Sem permissão', 'Você não tem permissão para acessar este relatório.')

  const { searchParams } = new URL(request.url)
  const hoje = hojeBahia()
  const dataParam = searchParams.get('data') || ''
  const data = /^\d{4}-\d{2}-\d{2}$/.test(dataParam) && dataParam <= hoje ? dataParam : hoje
  // Mesma validação/default de app/(app)/resumo/page.tsx -- ver achado documentado
  // em carregarResumoDiaCompleto (lib/resumo-dia.ts) sobre o PDF ignorar este parâmetro.
  const periodoParam = searchParams.get('periodo') || ''
  const periodo: PeriodoResumo = (['dia', 'semana', 'mes'] as const).includes(periodoParam as PeriodoResumo)
    ? (periodoParam as PeriodoResumo)
    : 'dia'

  const lojaParam = searchParams.get('loja')
  const lojaAtual = await getCurrentLojaId()
  let lojaSel: number | null
  if (lojaParam === 'todas') lojaSel = null
  else if (lojaParam && ator.lojaIds.includes(Number(lojaParam))) lojaSel = Number(lojaParam)
  else lojaSel = ator.lojaIds.includes(lojaAtual) ? lojaAtual : (ator.lojaIds[0] ?? null)
  const lojaIdsEfetivos = lojaSel ? [lojaSel] : ator.lojaIds

  let nomeLoja = 'Todas as lojas'
  if (lojaSel) {
    const supabase = createServiceClient()
    const { data: loja } = await supabase.from('lojas').select('nome, nome_fantasia').eq('id', lojaSel).single()
    nomeLoja = loja?.nome_fantasia || loja?.nome || `Loja ${lojaSel}`
  }

  // Relatório do período INTEIRO (dia/semana/mês, conforme escolhido na tela): todas
  // as categorias com seus detalhes.
  const { contagem, listas } = await carregarResumoDiaCompleto(lojaIdsEfetivos, data, periodo)
  const fmtBR = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
  const dataBR = fmtBR(data)
  const { dataIni } = janelaPeriodoBahia(data, periodo)
  const periodoLabel =
    periodo === 'dia' ? `Dia: ${dataBR}`
    : periodo === 'semana' ? `Semana: ${fmtBR(dataIni)} – ${dataBR}`
    : `Mês: ${fmtBR(dataIni)} – ${dataBR}`

  const element = createElement(ResumoDiaPDF, { loja: nomeLoja, periodoLabel, contagem, listas }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)
  const nomeArquivo = `resumo-${nomeLoja.replace(/\s+/g, '-').toLowerCase()}-${data}.pdf`

  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nomeArquivo}"` },
  })
}
