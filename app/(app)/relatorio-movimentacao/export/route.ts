import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilhaMulti, planilhaResponse, abaMatrizMensal, type AbaPlanilha, type ColunaExcel } from '@/lib/excel'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { escapeIlike } from '@/lib/utils-busca'
import {
  buscarMovimentosHistoricoBrutos,
  agregarMovimentacaoJS,
  filtrarLinhasMovHistorico,
  limiteJanelaQuente,
  type LinhaMovHistoricoBruta,
} from '@/lib/historico-contabo'
import { gerarMovimentacaoOperacaoAutomatica } from '@/lib/movimentacao-operacao-auto'

export const dynamic = 'force-dynamic'

type Qtd = { rotulo: string; mes: string; qtde: number }
type LinhaOper = { origem: string; sentido: 'E' | 'S'; local: string; tipo_sped: string; familia: string; mes: string; inventario: boolean; qtde: number; valor: number }

// Ver comentário equivalente em app/(app)/relatorio-movimentacao/page.tsx: no
// modo automático o valor de PDV vem do fato de cupom (real), não da
// aproximação do import manual antigo.
const valorConfiavel = (origem: string, sentido: 'E' | 'S', automatico: boolean) => automatico || !(/pdv/i.test(origem) && sentido === 'S')

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
    const familiasSel = valoresMulti(searchParams.get('familia') ?? '')
    const tiposSel = valoresMulti(searchParams.get('tipo') ?? '')
    const mesIni = searchParams.get('data_inicio')?.slice(0, 7) || null
    const mesFim = searchParams.get('data_final')?.slice(0, 7) || null

    const rowsImportadas: LinhaOper[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('movimentacao_operacao')
        .select('origem, sentido, local, tipo_sped, familia, mes, inventario, qtde, valor')
        .eq('loja_id', lojaId)
        .order('valor', { ascending: false })
        .range(p * 1000, p * 1000 + 999)
      if (error || !data?.length) break
      rowsImportadas.push(...(data as LinhaOper[]))
      if (data.length < 1000) break
    }
    const usarAutomatico = rowsImportadas.length === 0
    const produtoBusca = searchParams.get('produto') ?? undefined
    const rows = usarAutomatico ? await gerarMovimentacaoOperacaoAutomatica(lojaId, produtoBusca) : rowsImportadas
    if (!rows.length) return new Response('Sem movimentação por operação', { status: 404 })

    const abas: AbaPlanilha[] = []

    // Aba 1: Por operação (origem × sentido), respeitando filtro de local.
    const baseLocal = locsSel.length ? rows.filter((r) => locsSel.includes(r.local)) : rows
    const porOper = new Map<string, { origem: string; sentido: string; qtde: number; valor: number; conf: boolean }>()
    for (const r of baseLocal) {
      const k = `${r.origem}|${r.sentido}`
      const e = porOper.get(k) ?? { origem: r.origem, sentido: r.sentido === 'E' ? 'Entrada' : 'Saída', qtde: 0, valor: 0, conf: valorConfiavel(r.origem, r.sentido, usarAutomatico) }
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

    // Aba 3: matriz com família + local + tipo sempre juntos (mesmo padrão da
    // tela — sem exigir escolher 1 dimensão e clicar pra ver o resto).
    const filtradas = rows.filter((r) =>
      (!opsSel.length || opsSel.includes(r.origem)) &&
      (!locsSel.length || locsSel.includes(r.local)) &&
      (!sentSel.length || sentSel.includes(r.sentido)) &&
      (!familiasSel.length || familiasSel.includes(r.familia)) &&
      (!tiposSel.length || tiposSel.includes(r.tipo_sped)) &&
      (!mesIni || r.mes >= mesIni) &&
      (!mesFim || r.mes <= mesFim)
    )
    const soPdvSaida = filtradas.length > 0 && filtradas.every((r) => !valorConfiavel(r.origem, r.sentido, usarAutomatico))
    const linhasDim = filtradas.map((r) => ({
      rotulo: `${r.familia || 'N/D'} / ${r.local || 'N/D'} / ${r.tipo_sped || 'N/D'}`,
      mes: r.mes,
      valor: soPdvSaida ? Number(r.qtde) : (valorConfiavel(r.origem, r.sentido, usarAutomatico) ? Number(r.valor) : 0),
    }))
    const recorte = [
      opsSel.length ? opsSel.join(', ') : 'Todas as operações',
      locsSel.length ? locsSel.join(', ') : 'Todos os locais',
      sentSel.length === 1 ? (sentSel[0] === 'E' ? 'Entrada' : 'Saída') : 'Entrada+Saída',
    ].join(' · ')
    if (linhasDim.length) {
      abas.push(abaMatrizMensal({
        titulo: `Matriz por família / local / tipo (${soPdvSaida ? 'quantidade' : 'R$'})`,
        dimLabel: 'Família / Local / Tipo', linhas: linhasDim, subtitulo: recorte, nome: 'Família·Local·Tipo', moeda: !soPdvSaida,
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

  // Paginado com .range()+.order('id') -- achado real (auditoria 2026-07-18, mesmo
  // padrao do bug ja corrigido em relatorio-indicadores/page.tsx): 5 das 6 lojas
  // ativas tem mais de 1000 produtos, e um .select() sem paginacao cortava
  // silenciosamente no limite do PostgREST, excluindo produtos do filtro de
  // tipo/familia sem erro nem aviso.
  let codigosFiltro: number[] | null = null
  if (tiposSel.length || familiasSel.length) {
    const PAGE = 1000
    const produtosFiltrados: { codigo_produto: number | null }[] = []
    for (let p = 0; ; p++) {
      let pq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).order('id').range(p * PAGE, p * PAGE + PAGE - 1)
      if (tiposSel.length) pq = pq.in('tipo_item', tiposSel)
      if (familiasSel.length) pq = pq.in('descricao_familia', familiasSel)
      const { data, error } = await pq
      if (error || !data?.length) break
      produtosFiltrados.push(...data)
      if (data.length < PAGE) break
    }
    codigosFiltro = [...new Set(produtosFiltrados.map((p) => p.codigo_produto).filter((v): v is number => v != null))]
  }
  // Mesmo motivo acima: locais "principais" (depósito) rotineiramente passam de
  // 1000 posições por loja.
  if (locaisSel.length) {
    const PAGE = 1000
    const posicoes: { n_cod_prod: number | null }[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('posicao_estoques')
        .select('n_cod_prod')
        .eq('loja_id', lojaId)
        .in('codigo_local_estoque', locaisSel.map(Number))
        .order('id')
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      posicoes.push(...data)
      if (data.length < PAGE) break
    }
    const codigosLocal = new Set(posicoes.map((p) => p.n_cod_prod as number))
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
  // Mesmo fix de app/(app)/relatorio-movimentacao/page.tsx (achado real,
  // auditoria de relatorios 2026-07-26): sem corteExcl, o dia exato do corte
  // entrava 2x (RPC + JS), inflando entradas/saidas.
  const corteExcl = new Date(Date.parse(cutoff) - 86400000).toISOString().slice(0, 10)

  let metaPorCodigo: Map<number, { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }> | null = null
  let precoPorProduto: Map<number, number> | null = null
  if (ini < cutoff) {
    // Achado real (auditoria Task 9, 2026-08-09): sem paginação -- mesma
    // classe de bug já corrigida em app/(app)/relatorio-movimentacao/page.tsx
    // (achado 2026-07-26, ver AGENTS.md) e em várias outras telas: PostgREST
    // corta em 1000 linhas por padrão sem erro, e 5 das 6 lojas ativas têm
    // mais de 1000 produtos. Sem efeito visível hoje (metaPorCodigo só
    // importa pros dims 'tipo'/'familia' em agregarMovimentacaoJS, e este
    // export sempre chama com dim='produto'), mas corrigido por consistência
    // com a page.tsx (mesmo padrão de paginação com .range()+.order('id')).
    const metaRowsTodos: { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('produtos')
        .select('codigo_produto, tipo_item, descricao_familia')
        .eq('loja_id', lojaId)
        .order('id')
        .range(p * 1000, p * 1000 + 999)
      if (error || !data?.length) break
      metaRowsTodos.push(...data)
      if (data.length < 1000) break
    }
    metaPorCodigo = new Map(metaRowsTodos.map((m) => [m.codigo_produto, m]))
    // Achado real (auditoria Task 9, 2026-08-09): 2 bugs na mesma query --
    // (1) sem paginacao (mesma classe do bug ja corrigido varias vezes nesta
    // sessao, ver AGENTS.md: PostgREST corta em 1000 linhas por padrao, e
    // lojas grandes tem muito mais que isso de itens com preco>0); (2) faltava
    // `.is('notas_fiscais.deleted_at', null)` + ordenar por d_emissao_nfe desc
    // pra replicar o CTE `preco` da RPC relatorio_movimentacao_matriz (preço
    // mais recente entre NFs nao-canceladas). Sem efeito visivel hoje (o
    // export "Em quantidade" só usa qtde, nunca valor/precoPorProduto), mas
    // mantém a reimplementação JS fiel ao SQL, como o comentário de
    // agregarMovimentacaoJS já pede -- corrigido no mesmo padrão de paginação
    // já usado acima para metaRows/produtos.
    const PAGE_PRECO = 1000
    const precoRowsTodos: { n_id_produto: number; n_preco_unit: number }[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('nota_fiscal_items')
        .select('n_id_produto, n_preco_unit, notas_fiscais!inner(deleted_at, d_emissao_nfe)')
        .eq('loja_id', lojaId)
        .gt('n_preco_unit', 0)
        .is('notas_fiscais.deleted_at', null)
        // Fix round 1 (revisão): `{ foreignTable }` só ordena o recurso
        // embutido, não a linha pai (mesmo achado do page.tsx acima) --
        // `order('tabela(coluna)')` sem essa opção é a forma correta.
        // Tiebreak por `id` pelo mesmo motivo (evita pular/duplicar linha
        // entre páginas quando `d_emissao_nfe` empata).
        .order('notas_fiscais(d_emissao_nfe)', { ascending: false })
        .order('id', { ascending: false })
        .range(p * PAGE_PRECO, p * PAGE_PRECO + PAGE_PRECO - 1)
      if (error || !data?.length) break
      precoRowsTodos.push(...(data as unknown as { n_id_produto: number; n_preco_unit: number }[]))
      if (data.length < PAGE_PRECO) break
    }
    precoPorProduto = new Map<number, number>()
    for (const r of precoRowsTodos) {
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
      const dataFinalFria = fim < corteExcl ? fim : corteExcl
      const brutasTodas = await buscarMovimentosHistoricoBrutos<LinhaMovHistoricoBruta>({
        lojaId, dataInicio: ini, dataFinal: dataFinalFria,
      })
      const brutas = filtrarLinhasMovHistorico(brutasTodas, codigosIn, produtoBusca)
      const antiga = agregarMovimentacaoJS(brutas, metaPorCodigo, precoPorProduto, 'produto', sentido)
      const combinados = new Map<string, Qtd>()
      for (const linha of [...antiga, ...qRecente]) {
        // JSON.stringify + Number(): mesmo fix de app/(app)/relatorio-movimentacao/page.tsx
        // (rotulo pode conter "|", e qtde vem de RPC como string via PostgREST).
        const chave = JSON.stringify([linha.rotulo, linha.mes])
        const acc = combinados.get(chave) ?? { rotulo: linha.rotulo, mes: linha.mes, qtde: 0 }
        acc.qtde += Number(linha.qtde) || 0
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
