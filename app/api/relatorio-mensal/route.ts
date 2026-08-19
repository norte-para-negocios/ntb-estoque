import { NextResponse } from 'next/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { carregarRelatorioMensal } from '@/lib/relatorio-mensal'
import { gerarRelatorioMensalPptx } from '@/lib/relatorio-mensal-pptx'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Relatório gerencial mensal em PPTX, mesmo formato que a NTB Consultoria
// (Ramon) monta manualmente todo mês pra Donana Vilas -- botão "Gerar
// relatório do mês" pede pra fazer isso pra qualquer loja, sem trabalho
// manual. Ver lib/relatorio-mensal.ts (dados) e lib/relatorio-mensal-pptx.ts
// (montagem do arquivo).
export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  // "mesAno" vem do <select> único da tela (valor "YYYY-M") -- evita precisar
  // de JS pra sincronizar dois campos separados num único <form method="get">.
  const [anoStr, mesStr] = (searchParams.get('mesAno') ?? '').split('-')
  const ano = Number(anoStr)
  const mes = Number(mesStr)
  const hoje = new Date()
  const anoResolvido = ano >= 2020 && ano <= hoje.getFullYear() + 1 ? ano : hoje.getFullYear()
  const mesResolvido = mes >= 1 && mes <= 12 ? mes : hoje.getMonth() + 1

  try {
    const dados = await carregarRelatorioMensal(lojaId, anoResolvido, mesResolvido)
    const buffer = await gerarRelatorioMensalPptx(dados)
    const nomeArquivo = `Relatório ${dados.loja.nome} - ${dados.mesLabel}.pptx`.replace(/[\\/:*?"<>|]/g, '')
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      },
    })
  } catch (e) {
    console.error('relatorio-mensal: falha ao gerar PPTX', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falha ao gerar relatório' },
      { status: 500 },
    )
  }
}
