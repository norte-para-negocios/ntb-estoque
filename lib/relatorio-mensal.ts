// Dados do relatório gerencial mensal (PPTX) por loja -- mesmo formato que a
// NTB Consultoria (Ramon) já monta manualmente todo mês pros clientes, hoje
// cruzando exports do Omie com planilhas próprias. Reaproveita as mesmas
// RPCs/helpers de lib/dashboard-gerencial.ts (construído com o mesmo
// propósito pro card da Home), só que escopado por mês fechado em vez de
// "ano corrente", e com os rankings/baixas que a Home não separa.
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { gerarMovimentacaoOperacaoAutomatica } from '@/lib/movimentacao-operacao-auto'
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

export type RelatorioMensal = {
  loja: { id: number; nome: string }
  ano: number
  mes: number
  mesLabel: string // "Julho de 2026"
  faturamentoGeral: {
    porTipo: RankingItem[] // ano todo até o mês, todos os tipos
    faturamentoMes: number
    faturamentoAno: number // jan até o mês do relatório
    pctComprasFatMes: number | null
    pctComprasFatMediaAno: number | null
  }
  vendasAcabado: { mais: RankingItem[]; menos: RankingItem[] }
  vendasRevenda: { mais: RankingItem[]; menos: RankingItem[] }
  familiaTop10: RankingItem[]
  fornecedorTop10: RankingItem[]
  comprasPerdas: {
    entradaNfPorTipo: RankingItem[]
    notasMes: number
    notasAno: number
    valorNotasMes: number
    valorNotasAno: number
    perdaMateriaPrimaPct: number | null // sobre faturamento de Produto Acabado, mês
    perdaRevendaPct: number | null // sobre faturamento de Revenda, mês
  }
  baixasEstoque: {
    revendaTop5: RankingItem[]
    materiaPrimaTop5: RankingItem[]
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

export async function carregarRelatorioMensal(lojaId: number, ano: number, mes: number): Promise<RelatorioMensal> {
  const supabase = createServiceClient()

  const { data: loja } = await supabase.from('lojas').select('id, nome_fantasia').eq('id', lojaId).single()
  const nomeLoja = (loja as { nome_fantasia: string } | null)?.nome_fantasia ?? `Loja ${lojaId}`

  const dataIniMes = primeiroDiaMes(ano, mes)
  const dataFimMes = ultimoDiaMes(ano, mes)
  const dataIniAno = primeiroDiaMes(ano, 1)
  const mesIniAno = dataIniAno.slice(0, 7)
  const mesFimRel = dataFimMes.slice(0, 7)

  const [
    faturamentoPorTipoAno,
    faturamentoPorProdutoAno,
    familiaAno,
    fornecedorAno,
    comprasPorTipoAno,
    comprasTotalMes,
    comprasTotalAno,
    rejeitosMes,
    faturamentoAcabadoMesRows,
    faturamentoRevendaMesRows,
    tipoPorDescricao,
    movimentosOper,
  ] = await Promise.all([
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId, p_dim: 'tipo', p_mes_ini: mesIniAno, p_mes_fim: mesFimRel, p_rotulos: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId, p_dim: 'produto', p_mes_ini: mesIniAno, p_mes_fim: mesFimRel, p_rotulos: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId, p_dim: 'familia', p_mes_ini: mesIniAno, p_mes_fim: mesFimRel, p_rotulos: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId, p_ini: dataIniAno, p_fim: dataFimMes, p_dim: 'fornecedor',
      p_familias: null, p_tipos: null, p_fornecedor: null, p_cfops: null, p_produto: null, p_local: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId, p_ini: dataIniAno, p_fim: dataFimMes, p_dim: 'tipo',
      p_familias: null, p_tipos: null, p_fornecedor: null, p_cfops: null, p_produto: null, p_local: null,
    }),
    supabase.rpc('relatorio_compras_total', {
      p_loja_id: lojaId, p_ini: dataIniMes, p_fim: dataFimMes,
      p_familias: null, p_tipos: null, p_fornecedor: null, p_cfops: null, p_produto: null, p_local: null,
    }),
    supabase.rpc('relatorio_compras_total', {
      p_loja_id: lojaId, p_ini: dataIniAno, p_fim: dataFimMes,
      p_familias: null, p_tipos: null, p_fornecedor: null, p_cfops: null, p_produto: null, p_local: null,
    }),
    rpcTodos<{ categoria: string; valor_total: number | null; qtd_movimentos: number }>(supabase, 'relatorio_rejeitos_por_tipo', {
      p_loja_id: lojaId, p_data_ini: dataIniMes, p_data_fim: dataFimMes,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId, p_dim: 'tipo', p_mes_ini: dataIniMes.slice(0, 7), p_mes_fim: dataIniMes.slice(0, 7), p_rotulos: [ROTULO_FATURAMENTO_ACABADO],
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId, p_dim: 'tipo', p_mes_ini: dataIniMes.slice(0, 7), p_mes_fim: dataIniMes.slice(0, 7), p_rotulos: [ROTULO_FATURAMENTO_REVENDA],
    }),
    buscarTipoPorDescricao(supabase, lojaId),
    gerarMovimentacaoOperacaoAutomatica(lojaId),
  ])

  // --- Faturamento geral (slide 2) ---
  const porTipoMapa = somarPorRotulo(faturamentoPorTipoAno)
  const faturamentoAno = Array.from(porTipoMapa.values()).reduce((s, v) => s + v, 0)
  const faturamentoMes = faturamentoPorTipoAno
    .filter((r) => r.mes === dataIniMes.slice(0, 7))
    .reduce((s, r) => s + Number(r.valor), 0)

  // % Compras/Fat: por mês individual, dentro do range jan..mês do relatório
  // (pra "média do ano"), usando o mesmo agrupamento por mes que a matriz de
  // faturamento já devolve. Compras não tem RPC "por mês" pronta como a de
  // faturamento -- soma-se comprasPorTipoAno (dim=tipo) por mês via o campo
  // `mes` que a matriz de compras também devolve.
  const faturamentoPorMes = new Map<string, number>()
  for (const r of faturamentoPorTipoAno) faturamentoPorMes.set(r.mes, (faturamentoPorMes.get(r.mes) ?? 0) + Number(r.valor))
  const comprasPorMes = new Map<string, number>()
  for (const r of comprasPorTipoAno) comprasPorMes.set(r.mes, (comprasPorMes.get(r.mes) ?? 0) + Number(r.valor))
  const pctPorMes: number[] = []
  for (const [mesChave, fat] of faturamentoPorMes) {
    if (fat > 0) pctPorMes.push(((comprasPorMes.get(mesChave) ?? 0) / fat) * 100)
  }
  const pctComprasFatMediaAno = pctPorMes.length ? pctPorMes.reduce((s, v) => s + v, 0) / pctPorMes.length : null
  const comprasMesChave = dataIniMes.slice(0, 7)
  const pctComprasFatMes =
    faturamentoMes > 0 ? ((comprasPorMes.get(comprasMesChave) ?? 0) / faturamentoMes) * 100 : null

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
  const faturamentoAcabadoMes = faturamentoAcabadoMesRows.reduce((s, r) => s + Number(r.valor), 0)
  const faturamentoRevendaMes = faturamentoRevendaMesRows.reduce((s, r) => s + Number(r.valor), 0)
  const rejeitoMP = rejeitosMes.find((r) => r.categoria === 'Matéria-prima')
  const rejeitoRevenda = rejeitosMes.find((r) => r.categoria === 'Revenda')

  // --- Baixas de estoque manual (slide 7) ---
  const baixasNoRange = movimentosOper.filter(
    (m) =>
      m.origem === 'Movimento Manual de Estoque' &&
      m.sentido === 'S' &&
      !m.inventario &&
      m.mes >= mesIniAno &&
      m.mes <= mesFimRel
  )
  const revendaBaixaMapa = new Map<string, number>()
  const mpBaixaMapa = new Map<string, number>()
  for (const m of baixasNoRange) {
    if (m.tipo_sped.startsWith('00-')) revendaBaixaMapa.set(m.produto, (revendaBaixaMapa.get(m.produto) ?? 0) + m.valor)
    else if (m.tipo_sped.startsWith('01-')) mpBaixaMapa.set(m.produto, (mpBaixaMapa.get(m.produto) ?? 0) + m.valor)
  }

  return {
    loja: { id: lojaId, nome: nomeLoja },
    ano,
    mes,
    mesLabel: `${MESES_PT[mes - 1]} de ${ano}`,
    faturamentoGeral: {
      porTipo: topNDoMapa(porTipoMapa, 10),
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
      entradaNfPorTipo: topNDoMapa(
        somarPorRotulo(comprasPorTipoAno.map((r) => ({ ...r, rotulo: labelTipoItem(r.rotulo) }))),
        10
      ),
      notasMes: Number((comprasTotalMes.data as ComprasTotalRow[] | null)?.[0]?.n_notas ?? 0),
      notasAno: Number((comprasTotalAno.data as ComprasTotalRow[] | null)?.[0]?.n_notas ?? 0),
      valorNotasMes: Number((comprasTotalMes.data as ComprasTotalRow[] | null)?.[0]?.valor ?? 0),
      valorNotasAno: Number((comprasTotalAno.data as ComprasTotalRow[] | null)?.[0]?.valor ?? 0),
      perdaMateriaPrimaPct:
        faturamentoAcabadoMes > 0 && rejeitoMP ? (Number(rejeitoMP.valor_total ?? 0) / faturamentoAcabadoMes) * 100 : null,
      perdaRevendaPct:
        faturamentoRevendaMes > 0 && rejeitoRevenda ? (Number(rejeitoRevenda.valor_total ?? 0) / faturamentoRevendaMes) * 100 : null,
    },
    baixasEstoque: {
      revendaTop5: topNDoMapa(revendaBaixaMapa, 5),
      materiaPrimaTop5: topNDoMapa(mpBaixaMapa, 5),
    },
  }
}
