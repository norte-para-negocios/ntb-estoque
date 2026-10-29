import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { carregarEntradasContabil } from '@/lib/nota-fiscal/entradas-contabil-loader'
import { COLUNAS_ENTRADAS_OMIE } from '@/lib/nota-fiscal/entradas-colunas'
import { planilhaResponse } from '@/lib/excel'

// Notas fiscais de entrada no formato do Omie (aba BD, uma linha por item, 195 colunas) para a contabilidade.
// Pedido do Ramon (reunião 27/10/2026): o mesmo arquivo que ele já manda do Sertão, agora da loja de estoque próprio.
// ?ini=AAAA-MM-DD&fim=AAAA-MM-DD (data de registro; padrão = mês passado) &situacao=concluidas|todas (padrão todas).
export const maxDuration = 120

const DIA = /^\d{4}-\d{2}-\d{2}$/

function mesPassado(): { ini: string; fim: string } {
  const hoje = new Date(Date.now() - 3 * 3600_000)
  const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1))
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 0))
  return { ini: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) }
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if ((await modoDaLoja(lojaId)) !== 'proprio') {
    return NextResponse.json({ error: 'Nesta loja as notas estão no Omie: baixe o relatório de Notas Fiscais de Entrada por lá.' }, { status: 400 })
  }

  const sp = new URL(request.url).searchParams
  const padrao = mesPassado()
  const ini = DIA.test(sp.get('ini') ?? '') ? sp.get('ini')! : padrao.ini
  const fim = DIA.test(sp.get('fim') ?? '') ? sp.get('fim')! : padrao.fim
  if (fim < ini) return NextResponse.json({ error: 'A data final é antes da inicial.' }, { status: 400 })
  if ((Date.parse(fim) - Date.parse(ini)) / 86400000 > 400) return NextResponse.json({ error: 'Período máximo: 13 meses.' }, { status: 400 })
  const soConcluidas = sp.get('situacao') === 'concluidas'

  const { linhas } = await carregarEntradasContabil(lojaId, ini, fim, soConcluidas)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('BD', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLUNAS_ENTRADAS_OMIE.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 2)) }))
  for (const l of linhas) ws.addRow(l)
  ws.getRow(1).font = { bold: true }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS_ENTRADAS_OMIE.length } }
  COLUNAS_ENTRADAS_OMIE.forEach((c, i) => {
    if (c.startsWith('Data ') || c.includes('Data de Validade')) ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy'
  })
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  const [a, m] = ini.split('-')
  return planilhaResponse(`NFS_ENT_${a}-${m}${ini.slice(0, 7) === fim.slice(0, 7) ? '' : `_a_${fim}`}.xlsx`, buffer)
}
