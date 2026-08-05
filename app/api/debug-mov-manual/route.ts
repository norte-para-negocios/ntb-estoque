// DEBUG TEMPORÁRIO (Task 6, investigação de bug no drill de movimentação
// manual) -- remover antes de finalizar a task.
import { NextRequest, NextResponse } from 'next/server'
import { buscarMovimentosManuais, buscarMetaProdutosMovManual, agregarMovimentacaoManual } from '@/lib/movimentacao-manual'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  if (sp.get('key') !== 'task6debug') return NextResponse.json({ error: 'nope' }, { status: 403 })
  const lojaId = Number(sp.get('loja_id') ?? '2')
  const ini = sp.get('ini') ?? '2026-01-01'
  const fim = sp.get('fim') ?? new Date().toISOString().slice(0, 10)

  const [linhas1, meta] = await Promise.all([
    buscarMovimentosManuais({ lojaId, dataInicio: ini, dataFinal: fim }),
    buscarMetaProdutosMovManual(lojaId),
  ])
  const linhas2 = await buscarMovimentosManuais({ lojaId, dataInicio: ini, dataFinal: fim })

  const semMeta1 = linhas1.filter((l) => l.id_prod == null || !meta.has(l.id_prod))
  const semMeta2 = linhas2.filter((l) => l.id_prod == null || !meta.has(l.id_prod))

  const agg1 = agregarMovimentacaoManual(linhas1, meta, new Map(), 'familia', 'saidas', {})
  const agg2 = agregarMovimentacaoManual(linhas2, meta, new Map(), 'familia', 'saidas', {})

  const somaPorRotulo = (agg: typeof agg1) => {
    const m = new Map<string, number>()
    for (const r of agg) m.set(r.rotulo, (m.get(r.rotulo) ?? 0) + r.valor)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }

  return NextResponse.json({
    lojaId, ini, fim,
    metaMapSize: meta.size,
    run1: { totalLinhas: linhas1.length, semMeta: semMeta1.length, top10Familias: somaPorRotulo(agg1) },
    run2: { totalLinhas: linhas2.length, semMeta: semMeta2.length, top10Familias: somaPorRotulo(agg2) },
    linhasIguais: linhas1.length === linhas2.length,
    idsRun1SemRun2: linhas1.filter((l) => !linhas2.some((x) => x.id === l.id)).length,
    idsRun2SemRun1: linhas2.filter((l) => !linhas1.some((x) => x.id === l.id)).length,
    amostraSemMeta: semMeta1.slice(0, 5).map((l) => ({ id: l.id, id_prod: l.id_prod, tipo: l.tipo, valor: l.valor, data: l.data })),
  })
}
