import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { gerarPlanilha, planilhaResponse, mesLabelCurto, type ColunaExcel } from '@/lib/excel'
import { descreverCFOP } from '@/lib/cfop'

export const dynamic = 'force-dynamic'

type Linha = { rotulo: string; mes: string; valor: number }
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number) => (Number.isFinite(n) ? `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-')

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const { searchParams } = new URL(request.url)
  const filtroIni = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '')
    ? (searchParams.get('data_inicio') as string)
    : null
  const filtroFim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '')
    ? (searchParams.get('data_final') as string)
    : null

  const supabase = createServiceClient()
  // RPC de faturamento não aceita período (removido na migration 057); o filtro
  // de data_inicio/data_final é aplicado aqui, igual à tela.
  const fat = await rpcTodos<Linha>(supabase, 'relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: 'tipo' })
  if (!fat.length) return new Response('Sem faturamento importado', { status: 404 })

  const fatPorMesTudo: Record<string, number> = {}
  for (const r of fat) fatPorMesTudo[r.mes] = (fatPorMesTudo[r.mes] ?? 0) + (Number(r.valor) || 0)
  const todosMeses = Object.keys(fatPorMesTudo).sort()

  const iniYM = filtroIni ? filtroIni.slice(0, 7) : null
  const fimYM = filtroFim ? filtroFim.slice(0, 7) : null
  const fatPorMes = Object.fromEntries(
    Object.entries(fatPorMesTudo).filter(([m]) => (!iniYM || m >= iniYM) && (!fimYM || m <= fimYM))
  )

  const anoIni = todosMeses[0].slice(0, 4)
  const anoFim = todosMeses[todosMeses.length - 1].slice(0, 4)
  const compIni = filtroIni ?? `${anoIni}-01-01`
  const compFim = filtroFim ?? `${anoFim}-12-31`

  // dim=cfop (em vez de tipo) pra excluir Ativo imobilizado: é investimento, não
  // gasto operacional (pedido do Ramon, reunião 06/07); mesma regra da tela.
  const localParam = searchParams.get('local')
  const localCod = localParam && !Number.isNaN(Number(localParam)) ? Number(localParam) : null
  const compRows = await rpcTodos<Linha>(supabase, 'relatorio_compras_matriz', {
    p_loja_id: lojaId, p_ini: compIni, p_fim: compFim, p_dim: 'cfop',
    p_local: localCod,
  })
  const comprasPorMes: Record<string, number> = {}
  for (const r of compRows) {
    if (descreverCFOP(r.rotulo).cat === 'Ativo imobilizado') continue
    comprasPorMes[r.mes] = (comprasPorMes[r.mes] ?? 0) + (Number(r.valor) || 0)
  }

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
    titulo: 'Indicadores · Faturamento × Compras',
    subtitulo: `${compIni} a ${compFim} · Meta: Compras ÷ Faturamento abaixo de 40% (ideal 35%)`,
    autoFiltro: true,
  })
  return planilhaResponse('indicadores-fat-compras', buffer)
}
