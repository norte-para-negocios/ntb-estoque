import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio, filtrarItensCompras, agregarComprasMatriz } from '@/lib/relatorio-frio-nf'
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
  // Achado real (auditoria 2026-08-09, Task 14): a URL de export nunca
  // carregava família/produto -- os dois filtravam a tela (RPCs recebem
  // tudo) mas o Excel sempre saía com o total da loja inteira, sem nenhum
  // aviso, mesmo com "Indicadores filtrados" visível na tela. Mesma classe
  // de bug já corrigida em relatorio-compras/page.tsx (comentário no
  // exportParams de lá). Espelha em tudo a lógica de page.tsx (dimensão,
  // filtro dos dois lados da razão, complemento frio de Compras).
  const familiasSel = valoresMulti(searchParams.get('familia') ?? undefined)
  const produtoTermo = searchParams.get('produto')?.trim() || null
  const localParam = searchParams.get('local')
  const localCod = localParam && !Number.isNaN(Number(localParam)) ? Number(localParam) : null

  const supabase = createServiceClient()
  // RPC de faturamento não aceita período (removido na migration 057); o filtro
  // de data_inicio/data_final é aplicado aqui, igual à tela. Dimensão espelha
  // page.tsx: produto > família > tipo (default), pra restringir os DOIS lados
  // da razão ao mesmo recorte quando um filtro está ativo.
  let fat: Linha[]
  if (produtoTermo) {
    const termoLower = produtoTermo.toLowerCase()
    const todos = await rpcTodos<Linha>(supabase, 'relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: 'produto' })
    fat = todos.filter((r) => r.rotulo.toLowerCase().includes(termoLower))
  } else if (familiasSel.length) {
    fat = await rpcTodos<Linha>(supabase, 'relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: 'familia', p_rotulos: familiasSel })
  } else {
    fat = await rpcTodos<Linha>(supabase, 'relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: 'tipo' })
  }
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
  // Janela quente cobre ~90 dias; RPC clampa o início, e o pedaço antigo vem
  // do Contabo reagregado em JS -- igual a page.tsx (sem isso o lado Compras
  // ficava truncado pra qualquer export que cruzasse os 90 dias, que é o
  // caso comum já que o período padrão é o ano inteiro).
  const corte = limiteJanelaQuente()
  const compIniRpc = compIni < corte ? corte : compIni
  const compRows = await rpcTodos<Linha>(supabase, 'relatorio_compras_matriz', {
    p_loja_id: lojaId, p_ini: compIniRpc, p_fim: compFim, p_dim: 'cfop',
    p_familias: familiasSel.length ? familiasSel : null,
    p_produto: produtoTermo,
    p_local: localCod,
    p_status: 'CONCLUIDA',
  })
  const comprasPorMes: Record<string, number> = {}
  for (const r of compRows) {
    if (descreverCFOP(r.rotulo).cat === 'Ativo imobilizado') continue
    comprasPorMes[r.mes] = (comprasPorMes[r.mes] ?? 0) + (Number(r.valor) || 0)
  }

  // Complemento frio (Contabo) do lado Compras, para [compIni, corte) -- igual a page.tsx.
  if (compIni < corte) {
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    type ProdMeta = { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }
    const [{ count: totalProdutos }, itensFrios] = await Promise.all([
      supabase.from('produtos').select('codigo_produto', { count: 'exact', head: true }).eq('loja_id', lojaId),
      buscarItensNFFrio({ lojaId, dataInicio: compIni, dataFinal: corteExcl }),
    ])
    const PAGE = 1000
    const numPaginas = Math.ceil((totalProdutos ?? 0) / PAGE)
    const blocos = await Promise.all(
      Array.from({ length: numPaginas }, (_, p) =>
        supabase
          .from('produtos').select('codigo_produto, tipo_item, descricao_familia').eq('loja_id', lojaId)
          .order('id').range(p * PAGE, p * PAGE + PAGE - 1)
      )
    )
    const prodMetaRaw = blocos.flatMap((r) => (r.data ?? []) as ProdMeta[])
    const meta = new Map<number, { tipo: string | null; familia: string | null }>()
    for (const p of prodMetaRaw) {
      meta.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
    }
    const filtrados = filtrarItensCompras(itensFrios, {
      status: 'CONCLUIDA', familias: familiasSel, tipos: [], fornecedor: null, cfops: [], produto: produtoTermo, local: localCod,
    }, meta)
    for (const l of agregarComprasMatriz(filtrados, 'cfop', meta)) {
      if (descreverCFOP(l.rotulo).cat === 'Ativo imobilizado') continue
      comprasPorMes[l.mes] = (comprasPorMes[l.mes] ?? 0) + l.valor
    }
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

  const filtrosDesc = [
    produtoTermo ? `produto: "${produtoTermo}"` : null,
    familiasSel.length ? `família: ${familiasSel.join(', ')}` : null,
    localCod !== null ? `local: ${localCod}` : null,
  ].filter(Boolean).join(' · ')

  const buffer = await gerarPlanilha(rows, colunas, {
    titulo: 'Indicadores · Faturamento × Compras',
    subtitulo: `${compIni} a ${compFim} · Meta: Compras ÷ Faturamento abaixo de 40% (ideal 35%)${filtrosDesc ? ` · Filtros: ${filtrosDesc}` : ''}`,
    autoFiltro: true,
  })
  return planilhaResponse('indicadores-fat-compras', buffer)
}
