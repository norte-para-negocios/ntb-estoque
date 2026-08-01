import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'

// Cache em memoria de curta duracao -- home/PainelGerencial recalculava os
// mesmos 10 agregados toda vez que a pagina carregava, mesmo em visitas
// repetidas segundos depois (achado real 2026-07-30, investigando lentidao
// da home). Valido: o app roda como processo systemd unico (nao serverless,
// nao multiplas instancias) -- um Map no topo do modulo persiste entre
// requisicoes com seguranca, sem precisar de Redis/cache externo.
const CACHE_TTL_MS = 90_000
const cacheDashboard = new Map<string, { dados: DashboardGerencial; expiraEm: number }>()

export type RankingItem = { label: string; valor: number }
export type RejeitoCategoria = { categoria: string; valorTotal: number; qtdMovimentos: number; pctDoFaturamento: number | null }
export type ProdutoParado = { codigoProduto: number; codigo: string; descricao: string; saldo: number; diasSemMovimento: number }
export type RatioCategoria = { categoria: string; compras: number; faturamento: number; pct: number | null }
export type DashboardGerencial = {
  rejeitos: RejeitoCategoria[]
  topFaturadosAcabado: RankingItem[]
  topFaturadosRevenda: RankingItem[]
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

// tipo_item por descricao de produto -- pra separar o top faturados por tipo
// (achado 2026-07-29: a planilha de referencia da consultoria separa "top 10
// mais faturados" em Produto Acabado, nao mistura com revenda). Paginado:
// lojas com catalogo grande (>1000 produtos) truncariam sem isso (mesma
// classe de bug ja corrigida varias vezes nesta sessao).
async function buscarTipoPorDescricao(
  supabase: ReturnType<typeof createServiceClient>,
  lojaId: number
): Promise<Map<string, string>> {
  const PAGE = 1000
  const mapa = new Map<string, string>()
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from('produtos')
      .select('descricao, tipo_item')
      .eq('loja_id', lojaId)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    for (const row of data as { descricao: string | null; tipo_item: string | null }[]) {
      if (row.descricao) mapa.set(row.descricao, row.tipo_item ?? '')
    }
    if (data.length < PAGE) break
  }
  return mapa
}

// Mapa codigo_produto -> descricao, usado pra resolver nomes de produto
// a partir do id numerico cru que /fat_agregado e /fat_cupom_itens
// devolvem (o fato do Contabo nao duplica a tabela produtos, so guarda
// o codigo). Mesmo padrao paginado de buscarTipoPorDescricao (produtos
// passa de 1000 linhas em 5 das 6 lojas ativas).
export async function buscarNomePorCodigo(
  supabase: ReturnType<typeof createServiceClient>,
  lojaId: number
): Promise<Map<number, string>> {
  const PAGE = 1000
  const mapa = new Map<number, string>()
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from('produtos')
      .select('codigo_produto, descricao, codigo')
      .eq('loja_id', lojaId)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    for (const row of data as { codigo_produto: number; descricao: string | null; codigo: string | null }[]) {
      mapa.set(Number(row.codigo_produto), row.descricao || row.codigo || String(row.codigo_produto))
    }
    if (data.length < PAGE) break
  }
  return mapa
}

export async function carregarDashboardGerencial(
  lojaId: number,
  dataIni: string,
  dataFim: string,
  topN: number
): Promise<DashboardGerencial> {
  const chaveCache = JSON.stringify([lojaId, dataIni, dataFim, topN])
  const emCache = cacheDashboard.get(chaveCache)
  if (emCache && emCache.expiraEm > Date.now()) return emCache.dados

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
    tipoPorDescricao,
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
    buscarTipoPorDescricao(supabase, lojaId),
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

  // Separa por tipo de produto (achado 2026-07-29: a planilha de referencia da
  // consultoria nao mistura produto acabado com revenda no "top faturados").
  // Produto sem match em tipoPorDescricao (ex.: "Taxa de Servico", que nao e
  // produto de catalogo) cai fora dos dois buckets -- nao aparece em nenhum
  // top, mesmo padrao de tolerancia ja usado em /pendencias-classificacao.
  const faturamentoPorProdutoMapa = somarPorRotulo(faturamentoPorProduto)
  const faturamentoAcabadoMapa = new Map<string, number>()
  const faturamentoRevendaMapa = new Map<string, number>()
  for (const [descricao, valor] of faturamentoPorProdutoMapa) {
    const tipo = tipoPorDescricao.get(descricao)
    if (tipo === '04') faturamentoAcabadoMapa.set(descricao, valor)
    else if (tipo === '00') faturamentoRevendaMapa.set(descricao, valor)
  }

  const resultado: DashboardGerencial = {
    rejeitos,
    topFaturadosAcabado: topNDoMapa(faturamentoAcabadoMapa, topN),
    topFaturadosRevenda: topNDoMapa(faturamentoRevendaMapa, topN),
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
  // Nao cacheia resultado com cara de falha transitoria (rejeitos, produtosParados
  // e topComprados todos vazios ao mesmo tempo) -- toda fonte acima engole erro e
  // devolve [], entao um blip do Supabase virava snapshot degradado servido pra
  // todo mundo por 90s. Sem cache, a proxima requisicao tenta de novo do zero.
  const pareceuDegradado = resultado.rejeitos.length === 0 && resultado.produtosParados.length === 0 && resultado.topComprados.length === 0
  if (!pareceuDegradado) {
    cacheDashboard.set(chaveCache, { dados: resultado, expiraEm: Date.now() + CACHE_TTL_MS })
  }
  return resultado
}
