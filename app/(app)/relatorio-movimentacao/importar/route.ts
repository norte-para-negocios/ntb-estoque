import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getCurrentLojaId, getAtorGestao, getUser } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { parseMovimentacaoResumo, type AbaLida } from '@/lib/movimentacao-import'

export const dynamic = 'force-dynamic'
const MAX = 25 * 1024 * 1024 // 25MB: o export COM a aba BD tem 168MB; tem que vir sem ela.

function clean(v: unknown): string | number | null {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return clean(o.result)
    if ('text' in o) return clean(o.text)
    if ('richText' in o) return (o.richText as { text: string }[]).map((t) => t.text).join('')
  }
  return (v as string | number | null) ?? null
}

export async function POST(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const form = await request.formData()
  const file = form.get('arquivo')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Envie o arquivo' }, { status: 400 })
  if (file.size > MAX) {
    return NextResponse.json(
      { error: 'Arquivo muito grande. Remova a aba "BD" (dados brutos) do Excel e salve de novo — só os resumos importam.' },
      { status: 413 },
    )
  }

  let abas: AbaLida[]
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    abas = wb.worksheets.map((ws) => {
      const linhas: (string | number | null)[][] = []
      ws.eachRow({ includeEmpty: true }, (row) => {
        linhas.push(((row.values as unknown[]) ?? []).slice(1).map(clean))
      })
      return { nome: ws.name, linhas }
    })
  } catch {
    return NextResponse.json({ error: 'Não consegui ler o Excel. Confira que é o MOV_DRV (sem a aba BD).' }, { status: 400 })
  }

  const ano = Number((file.name.match(/20\d\d/) ?? [])[0]) || new Date().getFullYear()
  const linhas = parseMovimentacaoResumo(abas, ano)
  if (!linhas.length) {
    return NextResponse.json(
      { error: 'Não achei a aba "BAIXA RESUMO" (baixa por tipo SPED). É o arquivo certo (MOV_DRV)?' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()
  await supabase.from('movimentacao_importada').delete().eq('loja_id', lojaId)
  const rows = linhas.map((l) => ({ loja_id: lojaId, dimensao: l.dimensao, rotulo: l.rotulo, mes: l.mes, valor: l.valor }))
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supabase.from('movimentacao_importada').insert(rows.slice(i, i + 1000))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  await supabase.from('movimentacao_import_meta').upsert({
    loja_id: lojaId,
    importado_em: new Date().toISOString(),
    importado_por: (await getUser())?.id ?? null,
    linhas: linhas.length,
    arquivo: file.name,
  })
  await registrarAuditoria('editar', 'movimentacao_importada', lojaId, `Import movimentação valorizada (${linhas.length} linhas)`)

  return NextResponse.json({ ok: true, linhas: linhas.length, ano })
}
