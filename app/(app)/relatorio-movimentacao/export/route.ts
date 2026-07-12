import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilhaMulti, planilhaResponse, abaMatrizMensal, type AbaPlanilha, type ColunaExcel } from '@/lib/excel'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { escapeIlike } from '@/lib/utils-busca'
import {
  buscarMovimentosHistoricoBrutos,
  agregarMovimentacaoJS,
  limiteJanelaQuente,
  type LinhaMovHistoricoBruta,
} from '@/lib/historico-contabo'

export const dynamic = 'force-dynamic'

type Qtd = { rotulo: string; mes: string; qtde: number }
type LinhaOper = { origem: string; sentido: 'E' | 'S'; local: string; tipo_sped: string; familia: string; mes: string; inventario: boolean; qtde: number; valor: number }

const valorConfiavel = (origem: string, sentido: 'E' | 'S') => !(/pdv/i.test(origem) && sentido === 'S')

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const { searchParams } = new URL(request.url)
  const supabase = createServiceClient()

  // ---------- Export do modo "Por operação" (BD do MOV_DRV) ----------
  if (searchParams.get('modo') === 'operacao') {
    // op/loc/sent vêm da URL como lista separada por vírgula (multi-select), mesmo
    // padrão de tipo/família em outras telas.
    const opsSel = valoresMulti(searchParams.get('op') ?? '')
    const locsSel = valoresMulti(searchParams.get('loc') ?? '')
    const sentSel = valoresMulti(searchParams.get('sent') ?? '').filter((v): v is 'E' | 'S' => v === 'E' || v === 'S')
    const dim = searchParams.get('dim') === 'local' ? 'local' : searchParams.get('dim') === 'tipo_sped' ? 'tipo_sped' : 'familia'

    const rows: LinhaOper[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('movimentacao_operacao')
        .select('origem, sentido, local, tipo_sped, familia, mes, inventario, qtde, valor')
        .eq('loja_id', lojaId)
        .order('valor', { ascending: false })
        .range(p * 1000, p * 1000 + 999)
      if (error || !data?.length) break
      rows.push(...(data as LinhaOper[]))
      if (data.length < 1000) break
    }
    if (!rows.length) return new Response('Sem movimentação por operação importada', { status: 404 })

    const abas: AbaPlanilha[] = []

    // Aba 1: Por operação (origem × sentido), respeitando filtro de local.
    const baseLocal = locsSel.length ? rows.filter((r) => locsSel.includes(r.local)) : rows
    const porOper = new Map<string, { origem: string; sentido: string; qtde: number; valor: number; conf: boolean }>()
    for (const r of baseLocal) {
      const k = `${r.origem}|${r.sentido}`
      const e = porOper.get(k) ?? { origem: r.origem, sentido: r.sentido === 'E' ? 'Entrada' : 'Saída', qtde: 0, valor: 0, conf: valorConfiavel(r.origem, r.sentido) }
      e.qtde += Number(r.qtde); e.valor += Number(r.valor)
      porOper.set(k, e)
    }
    const colsOper: ColunaExcel[] = [
      { key: 'origem', label: 'Operação', tipo: 'texto' },
      { key: 'sentido', label: 'Sentido', tipo: 'texto' },
      { key: 'qtde', label: 'Quantidade', tipo: 'numero', somar: true },
      { key: 'valor', label: 'Valor (R$)', tipo: 'moeda', somar: true },
    ]
    const rowsOper = [...porOper.values()]
      .sort((a, b) => (b.conf ? b.valor : 0) - (a.conf ? a.valor : 0))
      .map((o) => ({ origem: o.origem, sentido: o.sentido, qtde: o.qtde, valor: o.conf ? o.valor : 0 }))
    abas.push({ rows: rowsOper, colunas: colsOper, opts: { titulo: 'Movimentação por operação', subtitulo: locsSel.length ? `Local: ${locsSel.join(', ')}` : 'Todos os locais', autoFiltro: true }, nome: 'Por operação' })

    // Aba 2: Perdas reais (manual saída, fora inventário) por família e mês.
    const perdas = rows.filter((r) => r.origem === 'Movimento Manual de Estoque' && r.sentido === 'S' && !r.inventario)
      .map((r) => ({ rotulo: r.familia || 'N/D', mes: r.mes, valor: Number(r.valor) }))
    if (perdas.length) abas.push(abaMatrizMensal({ titulo: 'Perdas reais (baixa manual) por família', dimLabel: 'Família', linhas: perdas, nome: 'Perdas (R$)' }))

    // Aba 3: matriz da dimensão escolhida, com os filtros aplicados (PDV-saída = 0).
    const filtradas = rows.filter((r) =>
      (!opsSel.length || opsSel.includes(r.origem)) &&
      (!locsSel.length || locsSel.includes(r.local)) &&
      (!sentSel.length || sentSel.includes(r.sentido))
    )
    const soPdvSaida = filtradas.length > 0 && filtradas.every((r) => !valorConfiavel(r.origem, r.sentido))
    const linhasDim = filtradas.map((r) => ({
      rotulo: (dim === 'local' ? r.local : dim === 'tipo_sped' ? r.tipo_sped : r.familia) || 'N/D',
      mes: r.mes,
      valor: soPdvSaida ? Number(r.qtde) : (valorConfiavel(r.origem, r.sentido) ? Number(r.valor) : 0),
    }))
    const dimLabel = dim === 'local' ? 'Local' : dim === 'tipo_sped' ? 'Tipo (SPED)' : 'Família'
    const recorte = [
      opsSel.length ? opsSel.join(', ') : 'Todas as operações',
      locsSel.length ? locsSel.join(', ') : 'Todos os locais',
      sentSel.length === 1 ? (sentSel[0] === 'E' ? 'Entrada' : 'Saída') : 'Entrada+Saída',
    ].join(' · ')
    if (linhasDim.length) {
      abas.push(abaMatrizMensal({
        titulo: `Matriz por ${dimLabel.toLowerCase()} (${soPdvSaida ? 'quantidade' : 'R$'})`,
        dimLabel, linhas: linhasDim, subtitulo: recorte, nome: `Por ${dimLabel.toLowerCase()}`, moeda: !soPdvSaida,
      }))
    }

    if (!abas.length) return new Response('Sem dados no recorte', { status: 404 })
    const buffer = await gerarPlanilhaMulti(abas)
    return planilhaResponse('movimentacao-operacao', buffer)
  }

  // ---------- Export do modo "Em quantidade" (dado nativo) ----------
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')! : hojeISO

  // Mesma lógica da page: tipo/família/local viram um conjunto de cod_prod, e a
  // busca de produto vai direto pro parâmetro p_produto da função.
  const tiposSel = valoresMulti(searchParams.get('tipo') ?? '')
  const familiasSel = valoresMulti(searchParams.get('familia') ?? '')
  const locaisSel = valoresMulti(searchParams.get('local') ?? '')
  const produtoBusca = searchParams.get('produto')?.trim() || null

  let codigosFiltro: number[] | null = null
  if (tiposSel.length || familiasSel.length) {
    let pq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    if (tiposSel.length) pq = pq.in('tipo_item', tiposSel)
    if (familiasSel.length) pq = pq.in('descricao_familia', familiasSel)
    const { data } = await pq
    codigosFiltro = [...new Set((data ?? []).map((p) => p.codigo_produto).filter((v): v is number => v != null))]
  }
  if (locaisSel.length) {
    const { data } = await supabase
      .from('posicao_estoques')
      .select('n_cod_prod')
      .eq('loja_id', lojaId)
      .in('codigo_local_estoque', locaisSel.map(Number))
    const codigosLocal = new Set((data ?? []).map((p) => p.n_cod_prod as number))
    codigosFiltro = codigosFiltro === null ? [...codigosLocal] : codigosFiltro.filter((c) => codigosLocal.has(c))
  }
  const codigosIn = codigosFiltro !== null ? (codigosFiltro.length ? codigosFiltro : [-1]) : null

  async function rpcTodos<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const PAGE = 1000
    const todos: T[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase.rpc(fn, args).range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      todos.push(...(data as T[]))
      if (data.length < PAGE) break
    }
    return todos
  }

  const cutoff = limiteJanelaQuente()
  const iniRpc = ini < cutoff ? cutoff : ini

  let metaPorCodigo: Map<number, { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }> | null = null
  let precoPorProduto: Map<number, number> | null = null
  if (ini < cutoff) {
    const { data: metaRows } = await supabase
      .from('produtos')
      .select('codigo_produto, tipo_item, descricao_familia')
      .eq('loja_id', lojaId)
    metaPorCodigo = new Map((metaRows ?? []).map((m) => [m.codigo_produto, m]))
    const { data: precoRows } = await supabase
      .from('nota_fiscal_items')
      .select('n_id_produto, n_preco_unit, notas_fiscais!inner(deleted_at)')
      .eq('loja_id', lojaId)
      .gt('n_preco_unit', 0)
    precoPorProduto = new Map<number, number>()
    for (const r of (precoRows ?? []) as { n_id_produto: number; n_preco_unit: number }[]) {
      if (r.n_id_produto && !precoPorProduto.has(r.n_id_produto)) precoPorProduto.set(r.n_id_produto, r.n_preco_unit)
    }
  }

  const abas: AbaPlanilha[] = []
  for (const [sentido, nome, label] of [
    ['saidas', 'Saídas por produto', 'Saídas (consumo/venda)'],
    ['entradas', 'Entradas por produto', 'Entradas'],
  ] as const) {
    const qRecente = await rpcTodos<Qtd>('relatorio_movimentacao_matriz', {
      p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: 'produto', p_sentido: sentido,
      p_cod_prods: codigosIn, p_produto: produtoBusca ? escapeIlike(produtoBusca) : null,
    })
    let q: Qtd[] = qRecente
    if (ini < cutoff && metaPorCodigo && precoPorProduto) {
      const brutas = await buscarMovimentosHistoricoBrutos<LinhaMovHistoricoBruta>({
        lojaId, dataInicio: ini, dataFinal: cutoff,
      })
      const antiga = agregarMovimentacaoJS(brutas, metaPorCodigo, precoPorProduto, 'produto', sentido)
      const combinados = new Map<string, Qtd>()
      for (const linha of [...antiga, ...qRecente]) {
        const chave = `${linha.rotulo}|${linha.mes}`
        const acc = combinados.get(chave) ?? { rotulo: linha.rotulo, mes: linha.mes, qtde: 0 }
        acc.qtde += linha.qtde
        combinados.set(chave, acc)
      }
      q = [...combinados.values()]
    }
    const linhas = q.map((r) => ({ rotulo: formatarNomeProduto(r.rotulo) || r.rotulo, mes: r.mes, valor: Number(r.qtde) || 0 }))
    if (linhas.length) abas.push(abaMatrizMensal({ titulo: `Movimentação — ${label} (quantidade)`, dimLabel: 'Produto', linhas, nome, moeda: false }))
  }

  if (!abas.length) return new Response('Sem movimentação no período', { status: 404 })
  const buffer = await gerarPlanilhaMulti(abas)
  return planilhaResponse('movimentacao', buffer)
}
