import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao, isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { SyncButton } from '@/components/SyncButton'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { SELO_CLASSE } from '@/lib/status-cor'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { btnClass } from '@/components/ui-kit/Button'
import { escapeIlike, escapeIlikeOr, buscarTudoPaginado } from '@/lib/utils-busca'
import { buscarFamilias } from '@/lib/actions/produto'
import { FileText, Download } from 'lucide-react'
import { buscarFrioTudo, contarNotasFiscaisAntigas, limiteJanelaQuente } from '@/lib/historico-contabo'
import { statusNF, NAO_CANCELADA_OR, statusBateFiltro } from '@/lib/nf-status'

const POR_PAGINA = 50

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

type NotaCompleta = {
  id: number
  d_emissao_nfe: string | null
  c_numero_nfe: string | null
  c_razao_social: string | null
  c_nome: string | null
  n_valor_nfe: number | string | null
  c_etapa: string | null
  c_natureza_operacao: string | null
  c_modelo_nfe: string | null
  c_serie_nfe: string | null
  full_object: unknown
}

const COLUNAS_SORT = ['d_emissao_nfe', 'c_numero_nfe', 'c_razao_social', 'n_valor_nfe', 'c_etapa'] as const
type ColSort = (typeof COLUNAS_SORT)[number]

// Categorias semanticas de NF baseadas em keyword matching na natureza da operacao.
// 'venda' = tudo que nao e bonificacao/cupom/comodato/remessa.
const CATEGORIAS_NF = [
  { value: 'bonificacao', label: 'Bonificação / Brinde', keywords: ['BONIF', 'BRINDE', 'DOACAO', 'DOACÃO'] },
  { value: 'cupom', label: 'Cupom / NFC-e / ECF', keywords: ['CUPOM', 'ECF', 'NFC-E', 'NFC_E', 'NF VIA CUPOM'] },
  { value: 'comodato', label: 'Comodato', keywords: ['COMODATO'] },
  { value: 'remessa', label: 'Remessa', keywords: ['REMESSA'] },
  { value: 'devolucao', label: 'Devolução', keywords: ['DEVOL', 'RETORNO', 'RETORN'] },
  { value: 'venda', label: 'Venda (demais)', keywords: [] },
] as const
type CategoriaKey = (typeof CATEGORIAS_NF)[number]['value']

export default async function NotaFiscalPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    num_nfe?: string
    fornecedor?: string
    status?: string
    tipo?: string
    natureza?: string
    produto?: string
    categoria?: string
    page?: string
    ord?: string
    dir?: string
    familia?: string
    local?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()

  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const ordRaw = params.ord ?? 'd_emissao_nfe'
  const ord: ColSort = (COLUNAS_SORT as readonly string[]).includes(ordRaw) ? (ordRaw as ColSort) : 'd_emissao_nfe'
  const dir = params.dir === 'asc' ? 'asc' : 'desc'
  const supabase = await createClient()
  // Sync (Atualizar agora) virou admin-only. NF e importada do Omie (so leitura).
  const podeSync = await isAdmin()

  const dataInicio =
    params.data_inicio || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = params.data_final || new Date().toISOString().split('T')[0]

  // Resolve categoria(s) → chaves válidas para montar a clausula .or() combinada.
  // Multi-select: uma linha entra se casar com QUALQUER categoria selecionada.
  const categoriaKeys = valoresMulti(params.categoria).filter((v): v is CategoriaKey =>
    (CATEGORIAS_NF.map((c) => c.value) as string[]).includes(v),
  )
  // Para categoria "venda" precisamos excluir tudo que bate com as outras keywords.
  const todasOutrasKeywords = CATEGORIAS_NF.filter((c) => c.keywords.length > 0).flatMap((c) => c.keywords)
  const keywordsSelecionados = [
    ...new Set(
      categoriaKeys
        .filter((k) => k !== 'venda')
        .flatMap((k) => CATEGORIAS_NF.find((c) => c.value === k)?.keywords ?? []),
    ),
  ]
  // Monta a clausula .or() combinada uma unica vez (reaplicada na query de lista e na de totais).
  const categoriaOrClause: string | null = (() => {
    if (!categoriaKeys.length) return null
    const orParts = keywordsSelecionados.map((kw) => `c_natureza_operacao.ilike.%${kw}%`)
    if (categoriaKeys.includes('venda')) {
      const notParts = todasOutrasKeywords.map((kw) => `c_natureza_operacao.not.ilike.%${kw}%`)
      orParts.push(`and(${notParts.join(',')})`)
    }
    return orParts.length ? orParts.join(',') : null
  })()

  // Tipo: nota_fiscal_items nao tem tipo; cruza via produtos.tipo_item -> codigo_produto -> produto_codigo do item.
  // Produto: itens cujo c_descricao_produto ou c_codigo_produto casem.
  // Ambos resolvem nota_fiscal_id distintos em nota_fiscal_items -> notas_fiscais.id in (...).
  // Resolvido ANTES da query para que lista e totais reusem o mesmo conjunto de ids.
  // tipo vem como lista separada por virgula (multi-select) na URL.
  const tiposArr = valoresMulti(params.tipo)
  const familiasArr = valoresMulti(params.familia)
  const localCod = params.local && !Number.isNaN(Number(params.local)) ? Number(params.local) : null
  let notaIds: number[] | null = null
  if (tiposArr.length || familiasArr.length || params.produto || localCod !== null) {
    let codigos: string[] | null = null
    if (tiposArr.length || familiasArr.length) {
      // Paginado: produtos.tipo_item pode passar de 1000 linhas numa unica loja
      // (ex: loja 6, tipo "99" tem 1143) -- sem .range() o PostgREST trunca em
      // silencio e o filtro de tipo/familia some com notas validas.
      const prodCodigos = await buscarTudoPaginado<{ codigo_produto: string | number }>((from, to) => {
        let q = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).order('id', { ascending: true }).range(from, to)
        if (tiposArr.length) q = q.in('tipo_item', tiposArr)
        if (familiasArr.length) q = q.in('descricao_familia', familiasArr)
        return q
      })
      codigos = prodCodigos.map((p) => String(p.codigo_produto))
      if (codigos.length === 0) {
        notaIds = []
      }
    }

    if (notaIds === null) {
      // Paginado: nota_fiscal_items facilmente passa de 1000 linhas por loja
      // (toda loja ativa ja passa disso) -- mesma razao acima.
      const itemRows = await buscarTudoPaginado<{ nota_fiscal_id: number | null }>((from, to) => {
        let q = supabase
          .from('nota_fiscal_items')
          .select('nota_fiscal_id')
          .eq('loja_id', lojaId)
          .order('id', { ascending: true })
          .range(from, to)
        if (codigos) q = q.in('produto_codigo', codigos)
        if (params.produto) {
          const p = escapeIlikeOr(params.produto)
          q = q.or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
        }
        if (localCod !== null) {
          q = q.eq('full_object->itensAjustes->>codigo_local_estoque', String(localCod))
        }
        return q
      })
      notaIds = Array.from(
        new Set(itemRows.map((r) => r.nota_fiscal_id).filter((v): v is number => v != null)),
      )
    }
  }
  const idsIn = notaIds !== null ? (notaIds.length ? notaIds : [-1]) : null
  const idsInSet = idsIn ? new Set(idsIn) : null

  // Query da listagem (paginada).
  let query = supabase
    .from('notas_fiscais')
    .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, c_natureza_operacao, c_modelo_nfe, c_serie_nfe, full_object')
    .eq('loja_id', lojaId)
    .gte('d_emissao_nfe', dataInicio)
    .lte('d_emissao_nfe', dataFinal)
    .is('deleted_at', null)
    .order(ord, { ascending: dir === 'asc' })
    .range((page - 1) * POR_PAGINA, page * POR_PAGINA) // busca N+1 para detectar próxima
  if (params.num_nfe) query = query.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
  if (params.fornecedor) query = query.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
  // Status: 'CONCLUIDA'/'PENDENTE'/'CANCELADA' (novos), 'C'/'P' (compat com
  // links antigos) ou a etapa real direta (ex.: '60', '40') -- ver lib/nf-status.ts.
  if (params.status === 'C' || params.status === 'CONCLUIDA') query = query.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
  else if (params.status === 'P' || params.status === 'PENDENTE') query = query.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
  else if (params.status === 'CANCELADA') query = query.eq('full_object->infoCadastro->>cCancelada', 'S')
  else if (params.status) query = query.eq('c_etapa', params.status)
  if (params.natureza) query = query.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
  if (categoriaOrClause) query = query.or(categoriaOrClause)
  if (idsIn) query = query.in('id', idsIn)

  // Query dos totais (mesmos filtros, sem paginacao visivel ao usuario): soma R$ + count.
  // Paginada por baixo dos panos -- confirmado empiricamente que o PostgREST trunca
  // em 1000 linhas mesmo com `.limit(100000)` explicito (nao ha erro, so silencio),
  // e nenhuma loja hoje passa disso em notas_fiscais mas o numero cresce todo dia.
  function buildTotaisQuery(from: number, to: number) {
    let q = supabase
      .from('notas_fiscais')
      .select('id, n_valor_nfe')
      .eq('loja_id', lojaId)
      .gte('d_emissao_nfe', dataInicio)
      .lte('d_emissao_nfe', dataFinal)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, to)
    if (params.num_nfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
    if (params.fornecedor) q = q.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
    if (params.status === 'C' || params.status === 'CONCLUIDA') q = q.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (params.status === 'P' || params.status === 'PENDENTE') q = q.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (params.status === 'CANCELADA') q = q.eq('full_object->infoCadastro->>cCancelada', 'S')
    else if (params.status) q = q.eq('c_etapa', params.status)
    if (params.natureza) q = q.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
    if (categoriaOrClause) q = q.or(categoriaOrClause)
    if (idsIn) q = q.in('id', idsIn)
    return q
  }

  const [{ data: notasRaw }, totaisRaw] = await Promise.all([
    query,
    buscarTudoPaginado<{ id: number; n_valor_nfe: number | string | null }>(buildTotaisQuery),
  ])

  let notas = notasRaw
  let temProxima = (notasRaw?.length ?? 0) > POR_PAGINA
  let qtdNotas = totaisRaw.length
  let totalValor = totaisRaw.reduce((a, r) => a + (Number(r.n_valor_nfe) || 0), 0)
  let totaisParciais = false

  if (dataInicio < limiteJanelaQuente()) {
    // Periodo cruza a janela quente: nao da pra confiar na paginacao nativa do
    // Supabase sozinha (o Contabo pode ter linhas no meio do intervalo pedido) --
    // busca tudo dos dois lados (com os MESMOS filtros da query principal), ordena
    // e pagina em memoria.
    //
    // Busca a fatia fria UMA vez so (mesmos filtros loja/data/busca servem tanto
    // pro badge quanto pra lista paginada -- antes eram 2 chamadas identicas ao
    // Contabo, uma por complementarNotasFiscais em cada uso) e cruza com uma
    // contagem real de referencia (count=true, sem LIMIT) pra saber se a
    // paginacao trouxe tudo. Achado real (auditoria Notas Fiscais 2026-07-19):
    // o badge variava a CADA carregamento (loja 5, "desde o inicio": 1423,
    // depois 1932, valor real 2629) por causa de timeout intermitente numa
    // pagina do meio da paginacao fria (raiz corrigida em lib/historico-
    // contabo.ts: timeout curto demais + falha tratada igual a "acabaram as
    // paginas") -- esse aviso fica como cinto-de-seguranca, mesmo padrao ja
    // usado em ordem-producao/page.tsx.
    const busca = params.num_nfe || params.fornecedor
    const [friasRaw, friasTotalReal] = await Promise.all([
      buscarFrioTudo<NotaCompleta>('/notas_fiscais', { loja_id: lojaId, data_inicio: dataInicio, data_final: dataFinal, busca }, 2000),
      contarNotasFiscaisAntigas({ lojaId, dataInicio, dataFinal, busca }),
    ])
    if (friasRaw.length < friasTotalReal) totaisParciais = true

    // buscarFrioTudo (Contabo) so filtra por loja/data/busca -- nao conhece o
    // filtro de status (mesma limitacao ja documentada abaixo pra tipo/familia/
    // produto/local). Sem isso, qualquer periodo que cruze a janela quente
    // trazia notas de QUALQUER status na fatia fria, inflando o badge e
    // misturando situacoes na lista quando um filtro de Situacao estava ativo.
    const statusAtivo = params.status
    const friasFiltradas = statusAtivo ? friasRaw.filter((nf) => statusBateFiltro(nf, statusAtivo)) : friasRaw

    const vistosQuentes = new Set(totaisRaw.map((r) => r.id))
    const totaisCompletosBrutos = [...totaisRaw, ...friasFiltradas.filter((r) => !vistosQuentes.has(r.id))]
    // complementarNotasFiscais (e o buscarFrioTudo acima, que a substitui aqui)
    // busca a fatia fria so por loja/data/busca -- nao conhece o filtro de
    // tipo/familia/produto/local (limitacao ja documentada no AGENTS.md: "o
    // cruzamento com o Contabo nao foi implementado para esse caso
    // especifico"). Sem filtrar aqui, TODA nota fria do periodo entra no
    // merge, inflando o total quando esse filtro esta ativo e o periodo cruza
    // os 90 dias (achado real: loja 6, tipo=99, badge mostrando 1907 em vez de
    // 2). idsInSet ja veio das notas que casam no lado quente; aplicar o mesmo
    // filtro na fatia fria evita a inflacao (ainda pode faltar nota cuja unica
    // referencia de item exista so no Contabo -- limitacao que continua aberta).
    const totaisCompletos = idsInSet ? totaisCompletosBrutos.filter((r) => idsInSet.has(r.id)) : totaisCompletosBrutos
    qtdNotas = totaisCompletos.length
    totalValor = totaisCompletos.reduce((a, r) => a + (Number(r.n_valor_nfe) || 0), 0)

    // Paginado (nao mais `.limit(2000)`): a fatia quente tambem pode passar de
    // 1000 linhas -- mesmo estouro do PostgREST descrito acima, so que aqui
    // truncaria a pagina em memoria (nao so o total exibido).
    const paginaCompletaRaw = await buscarTudoPaginado<NotaCompleta>((from, to) => {
      let q = supabase
        .from('notas_fiscais')
        .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, c_natureza_operacao, c_modelo_nfe, c_serie_nfe, full_object')
        .eq('loja_id', lojaId)
        .gte('d_emissao_nfe', dataInicio)
        .lte('d_emissao_nfe', dataFinal)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to)
      if (params.num_nfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
      if (params.fornecedor) q = q.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
      if (params.status === 'C' || params.status === 'CONCLUIDA') q = q.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
      else if (params.status === 'P' || params.status === 'PENDENTE') q = q.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
      else if (params.status === 'CANCELADA') q = q.eq('full_object->infoCadastro->>cCancelada', 'S')
      else if (params.status) q = q.eq('c_etapa', params.status)
      if (params.natureza) q = q.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
      if (categoriaOrClause) q = q.or(categoriaOrClause)
      if (idsIn) q = q.in('id', idsIn)
      return q
    })
    // Reusa a mesma fatia fria (friasRaw) buscada acima -- mesmos filtros
    // loja/data/busca, evita uma segunda ida identica ao Contabo.
    const vistosQuentesLista = new Set(paginaCompletaRaw.map((r) => r.id))
    const todasBrutas = [...paginaCompletaRaw, ...friasFiltradas.filter((r) => !vistosQuentesLista.has(r.id))]
    // Mesma razao do totaisCompletos acima: a fatia fria nao respeita o filtro
    // de tipo/familia/produto/local sozinha.
    const todas = idsInSet ? todasBrutas.filter((r) => idsInSet.has(r.id)) : todasBrutas
    todas.sort((a, b) => {
      const av = a[ord] ?? ''
      const bv = b[ord] ?? ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return dir === 'asc' ? cmp : -cmp
    })
    const inicio = (page - 1) * POR_PAGINA
    const fatia = todas.slice(inicio, inicio + POR_PAGINA + 1)
    temProxima = fatia.length > POR_PAGINA
    notas = temProxima ? fatia.slice(0, POR_PAGINA) : fatia
  } else {
    notas = temProxima ? notasRaw!.slice(0, POR_PAGINA) : notasRaw
  }

  // Helper para construir URL de sort (mantém todos os searchParams existentes)
  function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
    const sp = new URLSearchParams()
    if (params.data_inicio) sp.set('data_inicio', params.data_inicio)
    if (params.data_final) sp.set('data_final', params.data_final)
    if (params.num_nfe) sp.set('num_nfe', params.num_nfe)
    if (params.fornecedor) sp.set('fornecedor', params.fornecedor)
    if (params.status) sp.set('status', params.status)
    if (params.tipo) sp.set('tipo', params.tipo)
    if (params.natureza) sp.set('natureza', params.natureza)
    if (params.produto) sp.set('produto', params.produto)
    if (params.categoria) sp.set('categoria', params.categoria)
    sp.set('ord', key)
    sp.set('dir', newDir)
    return `/nota-fiscal?${sp.toString()}`
  }

  const relatorioParams = new URLSearchParams()
  relatorioParams.set('data_inicio', dataInicio)
  relatorioParams.set('data_final', dataFinal)
  if (params.num_nfe) relatorioParams.set('num_nfe', params.num_nfe)
  if (params.fornecedor) relatorioParams.set('fornecedor', params.fornecedor)
  if (params.status) relatorioParams.set('status', params.status)
  if (params.tipo) relatorioParams.set('tipo', params.tipo)
  if (params.natureza) relatorioParams.set('natureza', params.natureza)
  if (params.produto) relatorioParams.set('produto', params.produto)
  if (params.categoria) relatorioParams.set('categoria', params.categoria)

  const [familiasOpcoes, { data: locaisRaw }] = await Promise.all([
    buscarFamilias(),
    supabase
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .order('descricao'),
  ])

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data Início' },
    { tipo: 'data', nome: 'data_final', label: 'Data Final' },
    { tipo: 'texto', nome: 'num_nfe', label: 'Nº NFe' },
    { tipo: 'texto', nome: 'fornecedor', label: 'Fornecedor' },
    {
      tipo: 'select',
      nome: 'status',
      label: 'Situação',
      opcoes: [
        { value: 'CONCLUIDA', label: 'Concluída' },
        { value: 'PENDENTE', label: 'Pendente' },
        { value: 'CANCELADA', label: 'Cancelada' },
      ],
    },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo', opcoes: PRODUTO_TIPO_ITEM },
    {
      tipo: 'multi-select',
      nome: 'familia',
      label: 'Família',
      opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })),
    },
    {
      tipo: 'select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
    { tipo: 'texto', nome: 'natureza', label: 'Natureza da operacao' },
    { tipo: 'texto', nome: 'produto', label: 'Produto' },
    {
      tipo: 'multi-select',
      nome: 'categoria',
      label: 'Categoria',
      opcoes: CATEGORIAS_NF.map((c) => ({ value: c.value, label: c.label })),
    },
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Notas Fiscais"
          icon={FileText}
          actions={
            <>
              <FiltrosGaveta
                basePath="/nota-fiscal"
                naoContar={['data_inicio', 'data_final']}
                campos={campos}
                defaults={{
                  data_inicio: dataInicio,
                  data_final: dataFinal,
                  num_nfe: params.num_nfe ?? '',
                  fornecedor: params.fornecedor ?? '',
                  status: params.status ?? '',
                  tipo: params.tipo ?? '',
                  natureza: params.natureza ?? '',
                  produto: params.produto ?? '',
                  categoria: params.categoria ?? '',
                  familia: params.familia ?? '',
                  local: params.local ?? '',
                }}
                persistirEm="/nota-fiscal"
              />
              <a
                href={`/nota-fiscal/relatorio?${relatorioParams.toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className={btnClass('outline')}
              >
                <FileText className="size-4" /> Relatório PDF
              </a>
              <a
                href={`/nota-fiscal/export?${relatorioParams.toString()}`}
                className={btnClass('outline')}
              >
                <Download className="size-4" /> Excel
              </a>
              {podeSync && <SyncButton endpoint="/api/sync/notas-fiscais" label="Atualizar agora" />}
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/nota-fiscal" campos={campos} naoMostrar={['data_inicio', 'data_final']} persistirEm="/nota-fiscal" />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-[13px] text-text-muted">
          <span className="font-semibold text-text">{qtdNotas}</span> {qtdNotas === 1 ? 'nota' : 'notas'} de {fmtData(dataInicio)} a {fmtData(dataFinal)}
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-[13px] text-text-muted">
          Total <Money value={totalValor} className="font-semibold text-text" />
        </span>
      </div>

      {totaisParciais && (
        <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-text-muted">
          Período muito longo: a contagem e o total acima podem estar abaixo do real (falha temporária ao
          buscar o histórico completo). Tente recarregar a página ou use um período mais curto.
        </p>
      )}

      <Lista
        linhas={notas ?? []}
        chaveLinha={(nf) => nf.id}
        sortAtual={ord}
        dirAtual={dir}
        sortHref={buildSortHref}
        colunas={[
          {
            label: 'Fornecedor',
            primaria: true,
            sort: 'c_razao_social',
            render: (nf) => (
              <div className="min-w-0">
                <div className="truncate text-text">{nf.c_razao_social || nf.c_nome || '-'}</div>
                {nf.c_natureza_operacao && (
                  <div className="truncate text-[11px] text-text-muted" title={nf.c_natureza_operacao}>{nf.c_natureza_operacao}</div>
                )}
              </div>
            ),
          },
          { label: 'Emissão', sort: 'd_emissao_nfe', larguraDesktop: 'w-28', render: (nf) => <span className="num text-text-muted">{fmtData(nf.d_emissao_nfe)}</span> },
          { label: 'NFe', sort: 'c_numero_nfe', larguraDesktop: 'w-28', render: (nf) => (<span className="num">{nf.c_numero_nfe ?? '-'}{nf.c_serie_nfe ? <span className="text-text-muted">/{nf.c_serie_nfe}</span> : null}</span>) },
          {
            label: 'Situação',
            sort: 'c_etapa',
            larguraDesktop: 'w-36',
            render: (nf) => {
              const { label, tom } = statusNF(nf.c_etapa, nf.full_object)
              return (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SELO_CLASSE[tom]}`}>
                  {label}
                </span>
              )
            },
          },
          { label: 'Valor', sort: 'n_valor_nfe', alinhar: 'right', larguraDesktop: 'w-32', render: (nf) => <Money value={nf.n_valor_nfe} /> },
        ]}
        acao={(nf) => (
          <Link href={`/nota-fiscal/${nf.id}`} className="text-brand hover:underline whitespace-nowrap">
            Ver
          </Link>
        )}
        vazio={
          <EmptyState
            icon={FileText}
            title="Nenhuma nota fiscal no período"
            hint="Sincronize com o Omie ou ajuste os filtros."
          />
        }
      />

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/nota-fiscal" page={page} temProxima={temProxima} total={qtdNotas} porPagina={POR_PAGINA} />
      )}
    </div>
  )
}
