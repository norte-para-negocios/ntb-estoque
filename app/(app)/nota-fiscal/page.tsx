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
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { btnClass } from '@/components/ui-kit/Button'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { FileText, Download } from 'lucide-react'

const POR_PAGINA = 50

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
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
  let notaIds: number[] | null = null
  if (tiposArr.length || params.produto) {
    if (tiposArr.length) {
      const { data: prodCodigos } = await supabase
        .from('produtos')
        .select('codigo_produto')
        .eq('loja_id', lojaId)
        .in('tipo_item', tiposArr)

      const codigos = (prodCodigos ?? []).map((p) => String(p.codigo_produto))

      if (codigos.length === 0) {
        notaIds = []
      } else {
        let itemQuery = supabase
          .from('nota_fiscal_items')
          .select('nota_fiscal_id')
          .eq('loja_id', lojaId)
          .in('produto_codigo', codigos)
        if (params.produto) {
          const p = escapeIlikeOr(params.produto)
          itemQuery = itemQuery.or(
            `c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`,
          )
        }
        const { data: itemRows } = await itemQuery
        notaIds = Array.from(
          new Set((itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v): v is number => v != null)),
        )
      }
    } else if (params.produto) {
      const p = escapeIlikeOr(params.produto)
      const { data: itemRows } = await supabase
        .from('nota_fiscal_items')
        .select('nota_fiscal_id')
        .eq('loja_id', lojaId)
        .or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
      notaIds = Array.from(
        new Set((itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v): v is number => v != null)),
      )
    }
  }
  const idsIn = notaIds !== null ? (notaIds.length ? notaIds : [-1]) : null

  // Query da listagem (paginada).
  let query = supabase
    .from('notas_fiscais')
    .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, c_natureza_operacao, c_modelo_nfe, c_serie_nfe')
    .eq('loja_id', lojaId)
    .gte('d_emissao_nfe', dataInicio)
    .lte('d_emissao_nfe', dataFinal)
    .is('deleted_at', null)
    .order(ord, { ascending: dir === 'asc' })
    .range((page - 1) * POR_PAGINA, page * POR_PAGINA) // busca N+1 para detectar próxima
  if (params.num_nfe) query = query.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
  if (params.fornecedor) query = query.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
  // Status: 'C'/'P' (compat com links antigos) ou a etapa real direta (ex.: '60', '40').
  if (params.status === 'C') query = query.eq('c_etapa', '60')
  else if (params.status === 'P') query = query.neq('c_etapa', '60')
  else if (params.status) query = query.eq('c_etapa', params.status)
  if (params.natureza) query = query.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
  if (categoriaOrClause) query = query.or(categoriaOrClause)
  if (idsIn) query = query.in('id', idsIn)

  // Query dos totais (mesmos filtros, sem paginacao): soma R$ + count exato.
  let totaisQuery = supabase
    .from('notas_fiscais')
    .select('n_valor_nfe', { count: 'exact' })
    .eq('loja_id', lojaId)
    .gte('d_emissao_nfe', dataInicio)
    .lte('d_emissao_nfe', dataFinal)
    .is('deleted_at', null)
    .limit(100000)
  if (params.num_nfe) totaisQuery = totaisQuery.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
  if (params.fornecedor) totaisQuery = totaisQuery.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
  if (params.status === 'C') totaisQuery = totaisQuery.eq('c_etapa', '60')
  else if (params.status === 'P') totaisQuery = totaisQuery.neq('c_etapa', '60')
  else if (params.status) totaisQuery = totaisQuery.eq('c_etapa', params.status)
  if (params.natureza) totaisQuery = totaisQuery.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
  if (categoriaOrClause) totaisQuery = totaisQuery.or(categoriaOrClause)
  if (idsIn) totaisQuery = totaisQuery.in('id', idsIn)

  const [{ data: notasRaw }, { data: totaisRaw, count: totalNotas }] = await Promise.all([query, totaisQuery])
  const temProxima = (notasRaw?.length ?? 0) > POR_PAGINA
  const notas = temProxima ? notasRaw!.slice(0, POR_PAGINA) : notasRaw

  const qtdNotas = totalNotas ?? (totaisRaw?.length ?? 0)
  const totalValor = (totaisRaw ?? []).reduce((a, r) => a + (Number(r.n_valor_nfe) || 0), 0)

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

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data Início' },
    { tipo: 'data', nome: 'data_final', label: 'Data Final' },
    { tipo: 'texto', nome: 'num_nfe', label: 'Nº NFe' },
    { tipo: 'texto', nome: 'fornecedor', label: 'Fornecedor' },
    {
      tipo: 'select',
      nome: 'status',
      label: 'Etapa',
      opcoes: [
        { value: '60', label: 'Concluída (autorizada)' },
        { value: '40', label: 'Em recebimento' },
      ],
    },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo', opcoes: PRODUTO_TIPO_ITEM },
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
          { label: 'Etapa', sort: 'c_etapa', larguraDesktop: 'w-32', render: (nf) => <StatusPill status={nf.c_etapa === '60' ? 'Concluida' : 'Pendente'} /> },
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
        <Paginacao basePath="/nota-fiscal" page={page} temProxima={temProxima} total={totalNotas ?? undefined} porPagina={POR_PAGINA} />
      )}
    </div>
  )
}
