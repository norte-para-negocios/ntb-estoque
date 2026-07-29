import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'

export type RankingItem = { label: string; valor: number }
export type RejeitoCategoria = { categoria: string; valorTotal: number; qtdMovimentos: number; pctDoFaturamento: number | null }
export type ProdutoParado = { codigoProduto: number; codigo: string; descricao: string; saldo: number; diasSemMovimento: number }
export type RatioCategoria = { categoria: string; compras: number; faturamento: number; pct: number | null }
export type DashboardGerencial = {
  rejeitos: RejeitoCategoria[]
  topFaturados: RankingItem[]
  topComprados: RankingItem[]
  maiorFornecedor: RankingItem | null
  produtosParados: ProdutoParado[]
  ratioCompraFaturamento: RatioCategoria[]
}

type MatrizRow = { rotulo: string; mes: string; valor: number }
type ComprasTotalRow = { valor: number; n_notas: number }

// Rotulos EXATOS gravados por lib/omie/faturamento.ts (TIPO_NOME) -- nao usar
// os labels de PRODUTO_TIPO_ITEM (case/acentuacao diferentes: "Produto acabado"
// aqui vs "Produto Acabado" la).
const ROTULO_FATURAMENTO_ACABADO = 'Produto acabado'
const ROTULO_FATURAMENTO_REVENDA = 'Mercadoria p/ revenda'

function somarPorRotulo(rows: MatrizRow[]): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const r of rows) mapa.set(r.rotulo, (mapa.get(r.rotulo) ?? 0) + Number(r.valor))
  return mapa
}

function topNDoMapa(mapa: Map<string, number>, n: number): RankingItem[] {
  return Array.from(mapa.entries())
    .map(([label, valor]) => ({ label, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, n)
}

export async function carregarDashboardGerencial(
  lojaId: number,
  dataIni: string,
  dataFim: string,
  topN: number
): Promise<DashboardGerencial> {
  const supabase = createServiceClient()
  const mesIni = dataIni.slice(0, 7)
  const mesFim = dataFim.slice(0, 7)

  const [
    rejeitosRows,
    parados,
    faturamentoPorProduto,
    comprasPorProduto,
    comprasPorFornecedor,
    faturamentoAcabadoRows,
    faturamentoRevendaRows,
    comprasMateriaPrima,
    comprasRevenda,
  ] = await Promise.all([
    rpcTodos<{ categoria: string; valor_total: number | null; qtd_movimentos: number }>(supabase, 'relatorio_rejeitos_por_tipo', {
      p_loja_id: lojaId,
      p_data_ini: dataIni,
      p_data_fim: dataFim,
    }),
    supabase.rpc('relatorio_produtos_parados', { p_loja_id: lojaId, p_dias: 30 }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId,
      p_dim: 'produto',
      p_mes_ini: mesIni,
      p_mes_fim: mesFim,
      p_rotulos: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId,
      p_ini: dataIni,
      p_fim: dataFim,
      p_dim: 'produto',
      p_familias: null,
      p_tipos: null,
      p_fornecedor: null,
      p_cfops: null,
      p_produto: null,
      p_local: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId,
      p_ini: dataIni,
      p_fim: dataFim,
      p_dim: 'fornecedor',
      p_familias: null,
      p_tipos: null,
      p_fornecedor: null,
      p_cfops: null,
      p_produto: null,
      p_local: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId,
      p_dim: 'tipo',
      p_mes_ini: mesIni,
      p_mes_fim: mesFim,
      p_rotulos: [ROTULO_FATURAMENTO_ACABADO],
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId,
      p_dim: 'tipo',
      p_mes_ini: mesIni,
      p_mes_fim: mesFim,
      p_rotulos: [ROTULO_FATURAMENTO_REVENDA],
    }),
    supabase.rpc('relatorio_compras_total', {
      p_loja_id: lojaId,
      p_ini: dataIni,
      p_fim: dataFim,
      p_familias: null,
      p_tipos: ['01'],
      p_fornecedor: null,
      p_cfops: null,
      p_produto: null,
      p_local: null,
    }),
    supabase.rpc('relatorio_compras_total', {
      p_loja_id: lojaId,
      p_ini: dataIni,
      p_fim: dataFim,
      p_familias: null,
      p_tipos: ['00'],
      p_fornecedor: null,
      p_cfops: null,
      p_produto: null,
      p_local: null,
    }),
  ])

  const faturamentoAcabado = faturamentoAcabadoRows.reduce((s, r) => s + Number(r.valor), 0)
  const faturamentoRevenda = faturamentoRevendaRows.reduce((s, r) => s + Number(r.valor), 0)
  const comprasMP = Number((comprasMateriaPrima.data as ComprasTotalRow[] | null)?.[0]?.valor ?? 0)
  const comprasRev = Number((comprasRevenda.data as ComprasTotalRow[] | null)?.[0]?.valor ?? 0)

  const rejeitos: RejeitoCategoria[] = rejeitosRows.map((r) => {
    const base = r.categoria === 'Matéria-prima' ? faturamentoAcabado : r.categoria === 'Revenda' ? faturamentoRevenda : null
    return {
      categoria: r.categoria,
      valorTotal: Number(r.valor_total ?? 0),
      qtdMovimentos: Number(r.qtd_movimentos),
      pctDoFaturamento: base && base > 0 ? Math.round((Number(r.valor_total ?? 0) / base) * 1000) / 10 : null,
    }
  })

  const produtosParados: ProdutoParado[] = ((parados.data ?? []) as {
    codigo_produto: number
    codigo: string
    descricao: string
    n_saldo: number
    dias_sem_movimento: number
  }[]).map((p) => ({
    codigoProduto: Number(p.codigo_produto),
    codigo: p.codigo,
    descricao: p.descricao,
    saldo: Number(p.n_saldo),
    diasSemMovimento: Number(p.dias_sem_movimento),
  }))

  const fornecedorTop = topNDoMapa(somarPorRotulo(comprasPorFornecedor), 1)

  return {
    rejeitos,
    topFaturados: topNDoMapa(somarPorRotulo(faturamentoPorProduto), topN),
    topComprados: topNDoMapa(somarPorRotulo(comprasPorProduto), topN),
    maiorFornecedor: fornecedorTop[0] ?? null,
    produtosParados,
    ratioCompraFaturamento: [
      {
        categoria: 'Produto acabado (vs. compra de matéria-prima)',
        compras: comprasMP,
        faturamento: faturamentoAcabado,
        pct: faturamentoAcabado > 0 ? Math.round((comprasMP / faturamentoAcabado) * 1000) / 10 : null,
      },
      {
        categoria: 'Revenda (vs. compra de revenda)',
        compras: comprasRev,
        faturamento: faturamentoRevenda,
        pct: faturamentoRevenda > 0 ? Math.round((comprasRev / faturamentoRevenda) * 1000) / 10 : null,
      },
    ],
  }
}
