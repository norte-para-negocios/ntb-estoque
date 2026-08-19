// Dados do relatório gerencial mensal (PPTX) por loja -- mesmo formato do
// relatório R07 que a NTB Consultoria (Ramon) já manda pro cliente Donana
// Vilas (o mais recente e "mais profissional" segundo o próprio Ramon,
// 2026-08-18 -- ver docs/superpowers ou memória reference_relatorio_mensal_
// ramon_spec.md pro detalhe slide a slide). Reaproveita as mesmas RPCs de
// lib/dashboard-gerencial.ts, mas devolve SÉRIE MENSAL (não só total) pra
// alimentar gráfico de linha/barra de verdade, igual ao R07 -- não tabela.
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { labelTipoItem } from '@/lib/constants-omie'
import {
  type MatrizRow,
  type RankingItem,
  ROTULO_FATURAMENTO_ACABADO,
  ROTULO_FATURAMENTO_REVENDA,
  somarPorRotulo,
  topNDoMapa,
  bottomNDoMapa,
  buscarTipoPorDescricao,
} from '@/lib/dashboard-gerencial'

type ComprasTotalRow = { valor: number; n_notas: number }
type RejeitoRow = { categoria: string; valor_total: number | null; qtd_movimentos: number }

// Compras de Ativo Imobilizado não entram no "Compras/Faturamento" (fórmula
// real do Ramon, achada no relatório R06: (TC-CA)/TF -- Total Compras menos
// Compras de Ativo, sobre Total Faturamento).
const TIPO_ATIVO_IMOBILIZADO = '08'

export type SerieMensal = { meses: string[]; series: { nome: string; valores: number[] }[] }

export type RelatorioMensal = {
  loja: { id: number; nome: string }
  ano: number
  mes: number
  mesLabel: string // "Julho de 2026"
  mesAtualLabel: string // último mês do gráfico (pode ser o mês corrente, em andamento)
  faturamentoGeral: {
    serieTipo: SerieMensal
    serieFatVsCompras: { meses: string[]; faturamento: number[]; compras: number[] }
    faturamentoMes: number
    faturamentoAno: number // jan até o último mês do gráfico
    pctComprasFatMes: number | null
    pctComprasFatMediaAno: number | null
  }
  vendasAcabado: { mais: RankingItem[]; menos: RankingItem[] }
  vendasRevenda: { mais: RankingItem[]; menos: RankingItem[] }
  familiaTop10: RankingItem[]
  fornecedorTop10: RankingItem[]
  comprasPerdas: {
    serieEntradaNf: SerieMensal
    seriePerda: { meses: string[]; percMateriaPrima: (number | null)[]; percRevenda: (number | null)[] }
    notasMes: number
    notasAno: number
    valorNotasMes: number
    valorNotasAno: number
    perdaMateriaPrimaPctMes: number | null
    perdaRevendaPctMes: number | null
  }
}

function primeiroDiaMes(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-01`
}

function ultimoDiaMes(ano: number, mes: number): string {
  const dia = new Date(ano, mes, 0).getDate() // dia 0 do mês seguinte = último dia do mês
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
const MESES_PT_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// Chaves 'YYYY-MM' de janeiro do ano do relatório até `mesFimGrafico`.
function chavesMeses(ano: number, mesFimGrafico: number): string[] {
  const chaves: string[] = []
  for (let m = 1; m <= mesFimGrafico; m++) chaves.push(`${ano}-${String(m).padStart(2, '0')}`)
  return chaves
}

// Agrupa uma matriz (rotulo/mes/valor) em série por mês, só com as `topN`
// rotulos de maior total -- mesmo padrão visual do R07 (gráfico de linha
// com poucas séries, não uma por tipo/categoria existente).
function serieDeMatriz(rows: MatrizRow[], mesesChart: string[], topN: number): SerieMensal {
  const totalPorRotulo = somarPorRotulo(rows)
  const rotulosTop = topNDoMapa(totalPorRotulo, topN).map((r) => r.label)
  const porRotuloMes = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!rotulosTop.includes(r.rotulo)) continue
    if (!porRotuloMes.has(r.rotulo)) porRotuloMes.set(r.rotulo, new Map())
    const mapaMes = porRotuloMes.get(r.rotulo)!
    mapaMes.set(r.mes, (mapaMes.get(r.mes) ?? 0) + Number(r.valor))
  }
  return {
    meses: mesesChart.map((m) => MESES_PT_CURTO[Number(m.slice(5, 7)) - 1]),
    series: rotulosTop.map((nome) => ({
      nome,
      valores: mesesChart.map((m) => porRotuloMes.get(nome)?.get(m) ?? 0),
    })),
  }
}

export async function carregarRelatorioMensal(lojaId: number, ano: number, mes: number): Promise<RelatorioMensal> {
  const supabase = createServiceClient()

  const { data: loja } = await supabase.from('lojas').select('id, nome_fantasia').eq('id', lojaId).single()
  const nomeLoja = (loja as { nome_fantasia: string } | null)?.nome_fantasia ?? `Loja ${lojaId}`

  const hoje = new Date()
  // Gráfico vai até o mês corrente (mesmo em andamento) se o relatório for
  // do ano corrente -- igual ao R07 (relatório "de julho" mostra a linha
  // até agosto parcial). Se o relatório for de ano passado, para em dezembro.
  const mesFimGrafico = ano === hoje.getFullYear() ? Math.max(mes, hoje.getMonth() + 1) : 12
  const mesesChart = chavesMeses(ano, mesFimGrafico)
  const dataIniMes = primeiroDiaMes(ano, mes)
  const dataFimMes = ultimoDiaMes(ano, mes)
  const dataIniAno = primeiroDiaMes(ano, 1)
  const dataFimGrafico = ultimoDiaMes(ano, mesFimGrafico)
  const mesIniAno = dataIniAno.slice(0, 7)
  const mesFimGraficoChave = dataFimGrafico.slice(0, 7)
  const mesRelChave = dataIniMes.slice(0, 7)

  const [
    faturamentoPorTipoAno,
    faturamentoPorProdutoAno,
    familiaAno,
    fornecedorAno,
    comprasPorTipoAno,
    comprasTotalMes,
    comprasTotalAno,
    tipoPorDescricao,
    rejeitosPorMes,
  ] = await Promise.all([
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId, p_dim: 'tipo', p_mes_ini: mesIniAno, p_mes_fim: mesFimGraficoChave, p_rotulos: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId, p_dim: 'produto', p_mes_ini: mesIniAno, p_mes_fim: mesFimGraficoChave, p_rotulos: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId, p_dim: 'familia', p_mes_ini: mesIniAno, p_mes_fim: mesFimGraficoChave, p_rotulos: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId, p_ini: dataIniAno, p_fim: dataFimGrafico, p_dim: 'fornecedor',
      p_familias: null, p_tipos: null, p_fornecedor: null, p_cfops: null, p_produto: null, p_local: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId, p_ini: dataIniAno, p_fim: dataFimGrafico, p_dim: 'tipo',
      p_familias: null, p_tipos: null, p_fornecedor: null, p_cfops: null, p_produto: null, p_local: null,
    }),
    supabase.rpc('relatorio_compras_total', {
      p_loja_id: lojaId, p_ini: dataIniMes, p_fim: dataFimMes,
      p_familias: null, p_tipos: null, p_fornecedor: null, p_cfops: null, p_produto: null, p_local: null,
    }),
    supabase.rpc('relatorio_compras_total', {
      p_loja_id: lojaId, p_ini: dataIniAno, p_fim: dataFimGrafico,
      p_familias: null, p_tipos: null, p_fornecedor: null, p_cfops: null, p_produto: null, p_local: null,
    }),
    buscarTipoPorDescricao(supabase, lojaId),
    // relatorio_rejeitos_por_tipo não devolve quebra por mês (só agregado
    // do range pedido) -- uma chamada por mês do gráfico pra montar a série.
    Promise.all(
      mesesChart.map((chave) => {
        const anoM = Number(chave.slice(0, 4))
        const mesM = Number(chave.slice(5, 7))
        return rpcTodos<RejeitoRow>(supabase, 'relatorio_rejeitos_por_tipo', {
          p_loja_id: lojaId, p_data_ini: primeiroDiaMes(anoM, mesM), p_data_fim: ultimoDiaMes(anoM, mesM),
        }).then((rows) => ({ chave, rows }))
      })
    ),
  ])

  // --- Faturamento geral (slide 2) ---
  const porTipoMapaAno = somarPorRotulo(faturamentoPorTipoAno) // até mesFimGrafico
  const faturamentoAno = Array.from(porTipoMapaAno.values()).reduce((s, v) => s + v, 0)
  const faturamentoMes = faturamentoPorTipoAno.filter((r) => r.mes === mesRelChave).reduce((s, r) => s + Number(r.valor), 0)

  const comprasSemAtivo = comprasPorTipoAno.filter((r) => r.rotulo !== TIPO_ATIVO_IMOBILIZADO)
  const faturamentoPorMes = new Map<string, number>()
  for (const r of faturamentoPorTipoAno) faturamentoPorMes.set(r.mes, (faturamentoPorMes.get(r.mes) ?? 0) + Number(r.valor))
  const comprasPorMes = new Map<string, number>()
  for (const r of comprasSemAtivo) comprasPorMes.set(r.mes, (comprasPorMes.get(r.mes) ?? 0) + Number(r.valor))

  const pctPorMes: number[] = []
  for (const mesChave of mesesChart) {
    const fat = faturamentoPorMes.get(mesChave) ?? 0
    if (fat > 0) pctPorMes.push(((comprasPorMes.get(mesChave) ?? 0) / fat) * 100)
  }
  const pctComprasFatMediaAno = pctPorMes.length ? pctPorMes.reduce((s, v) => s + v, 0) / pctPorMes.length : null
  const pctComprasFatMes = faturamentoMes > 0 ? ((comprasPorMes.get(mesRelChave) ?? 0) / faturamentoMes) * 100 : null

  const serieFatVsCompras = {
    meses: mesesChart.map((m) => MESES_PT_CURTO[Number(m.slice(5, 7)) - 1]),
    faturamento: mesesChart.map((m) => faturamentoPorMes.get(m) ?? 0),
    compras: mesesChart.map((m) => comprasPorMes.get(m) ?? 0),
  }

  // --- Vendas por produto (slides 3/4) ---
  const faturamentoPorProdutoMapa = somarPorRotulo(faturamentoPorProdutoAno)
  const acabadoMapa = new Map<string, number>()
  const revendaMapa = new Map<string, number>()
  for (const [descricao, valor] of faturamentoPorProdutoMapa) {
    const tipo = tipoPorDescricao.get(descricao)
    if (tipo === '04') acabadoMapa.set(descricao, valor)
    else if (tipo === '00') revendaMapa.set(descricao, valor)
  }

  // --- Compras e perdas (slide 6) ---
  const faturamentoAcabadoPorMes = new Map<string, number>()
  const faturamentoRevendaPorMes = new Map<string, number>()
  for (const r of faturamentoPorTipoAno) {
    if (r.rotulo === ROTULO_FATURAMENTO_ACABADO) faturamentoAcabadoPorMes.set(r.mes, (faturamentoAcabadoPorMes.get(r.mes) ?? 0) + Number(r.valor))
    else if (r.rotulo === ROTULO_FATURAMENTO_REVENDA) faturamentoRevendaPorMes.set(r.mes, (faturamentoRevendaPorMes.get(r.mes) ?? 0) + Number(r.valor))
  }
  const percMPPorMes = new Map<string, number | null>()
  const percRevendaPorMes = new Map<string, number | null>()
  for (const { chave, rows } of rejeitosPorMes) {
    const mp = rows.find((r) => r.categoria === 'Matéria-prima')
    const rev = rows.find((r) => r.categoria === 'Revenda')
    const fatAcabado = faturamentoAcabadoPorMes.get(chave) ?? 0
    const fatRevenda = faturamentoRevendaPorMes.get(chave) ?? 0
    percMPPorMes.set(chave, fatAcabado > 0 && mp ? (Number(mp.valor_total ?? 0) / fatAcabado) * 100 : null)
    percRevendaPorMes.set(chave, fatRevenda > 0 && rev ? (Number(rev.valor_total ?? 0) / fatRevenda) * 100 : null)
  }
  const seriePerda = {
    meses: mesesChart.map((m) => MESES_PT_CURTO[Number(m.slice(5, 7)) - 1]),
    percMateriaPrima: mesesChart.map((m) => percMPPorMes.get(m) ?? null),
    percRevenda: mesesChart.map((m) => percRevendaPorMes.get(m) ?? null),
  }

  return {
    loja: { id: lojaId, nome: nomeLoja },
    ano,
    mes,
    mesLabel: `${MESES_PT[mes - 1]} de ${ano}`,
    mesAtualLabel: `${MESES_PT[mesFimGrafico - 1]} de ${ano}`,
    faturamentoGeral: {
      serieTipo: serieDeMatriz(faturamentoPorTipoAno, mesesChart, 3),
      serieFatVsCompras,
      faturamentoMes,
      faturamentoAno,
      pctComprasFatMes,
      pctComprasFatMediaAno,
    },
    vendasAcabado: { mais: topNDoMapa(acabadoMapa, 10), menos: bottomNDoMapa(acabadoMapa, 10) },
    vendasRevenda: { mais: topNDoMapa(revendaMapa, 10), menos: bottomNDoMapa(revendaMapa, 10) },
    familiaTop10: topNDoMapa(somarPorRotulo(familiaAno), 10),
    fornecedorTop10: topNDoMapa(somarPorRotulo(fornecedorAno), 10),
    comprasPerdas: {
      // relatorio_compras_matriz (dim='tipo') devolve o código cru do Omie
      // ('01','07'...) -- mesmo padrão de rotulagem já usado em
      // relatorio-compras/page.tsx (TIPO_LABEL / labelTipoItem).
      serieEntradaNf: serieDeMatriz(
        comprasPorTipoAno.map((r) => ({ ...r, rotulo: labelTipoItem(r.rotulo) })),
        mesesChart,
        3
      ),
      seriePerda,
      notasMes: Number((comprasTotalMes.data as ComprasTotalRow[] | null)?.[0]?.n_notas ?? 0),
      notasAno: Number((comprasTotalAno.data as ComprasTotalRow[] | null)?.[0]?.n_notas ?? 0),
      valorNotasMes: Number((comprasTotalMes.data as ComprasTotalRow[] | null)?.[0]?.valor ?? 0),
      valorNotasAno: Number((comprasTotalAno.data as ComprasTotalRow[] | null)?.[0]?.valor ?? 0),
      perdaMateriaPrimaPctMes: percMPPorMes.get(mesRelChave) ?? null,
      perdaRevendaPctMes: percRevendaPorMes.get(mesRelChave) ?? null,
    },
  }
}
