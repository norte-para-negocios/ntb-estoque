import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilha, planilhaResponse, mesLabelCurto, type ColunaExcel } from '@/lib/excel'

export const dynamic = 'force-dynamic'

type Linha = { rotulo: string; mes: string; valor: number }
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number) => (Number.isFinite(n) ? `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-')

export async function GET() {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const supabase = createServiceClient()
  const { data: fatRaw } = await supabase.rpc('relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: 'tipo' })
  const fat = (fatRaw ?? []) as Linha[]
  if (!fat.length) return new Response('Sem faturamento importado', { status: 404 })

  const fatPorMes: Record<string, number> = {}
  for (const r of fat) fatPorMes[r.mes] = (fatPorMes[r.mes] ?? 0) + (Number(r.valor) || 0)
  const fatMeses = Object.keys(fatPorMes).sort()
  const anoIni = fatMeses[0].slice(0, 4)
  const anoFim = fatMeses[fatMeses.length - 1].slice(0, 4)

  const { data: compRaw } = await supabase.rpc('relatorio_compras_matriz', {
    p_loja_id: lojaId, p_ini: `${anoIni}-01-01`, p_fim: `${anoFim}-12-31`, p_dim: 'tipo',
  })
  const comprasPorMes: Record<string, number> = {}
  for (const r of (compRaw ?? []) as Linha[]) comprasPorMes[r.mes] = (comprasPorMes[r.mes] ?? 0) + (Number(r.valor) || 0)

  const meses = [...new Set([...Object.keys(fatPorMes), ...Object.keys(comprasPorMes)])].sort()
  const totFat = meses.reduce((s, m) => s + (fatPorMes[m] ?? 0), 0)
  const totComp = meses.reduce((s, m) => s + (comprasPorMes[m] ?? 0), 0)

  const colunas: ColunaExcel[] = [{ key: 'indicador', label: 'Indicador', tipo: 'texto', largura: 26 }]
  for (const m of meses) colunas.push({ key: m, label: mesLabelCurto(m), tipo: 'texto' })
  colunas.push({ key: '__total', label: 'Total', tipo: 'texto' })

  const cel = (fn: (m: string) => string, total: string) => {
    const row: Record<string, unknown> = {}
    for (const m of meses) row[m] = fn(m)
    row.__total = total
    return row
  }
  const rows = [
    { indicador: 'Faturamento (vendas)', ...cel((m) => fmtMoeda(fatPorMes[m] ?? 0), fmtMoeda(totFat)) },
    { indicador: 'Compras (NF de entrada)', ...cel((m) => fmtMoeda(comprasPorMes[m] ?? 0), fmtMoeda(totComp)) },
    { indicador: 'Faturamento − Compras', ...cel((m) => fmtMoeda((fatPorMes[m] ?? 0) - (comprasPorMes[m] ?? 0)), fmtMoeda(totFat - totComp)) },
    { indicador: 'Compras ÷ Faturamento', ...cel((m) => fmtPct(fatPorMes[m] ? ((comprasPorMes[m] ?? 0) / fatPorMes[m]) * 100 : NaN), fmtPct(totFat > 0 ? (totComp / totFat) * 100 : NaN)) },
  ]

  const buffer = await gerarPlanilha(rows, colunas, {
    titulo: 'Indicadores — Faturamento × Compras',
    subtitulo: 'Meta: Compras ÷ Faturamento abaixo de 40% (ideal 35%)',
    autoFiltro: true,
  })
  return planilhaResponse('indicadores-fat-compras', buffer)
}
