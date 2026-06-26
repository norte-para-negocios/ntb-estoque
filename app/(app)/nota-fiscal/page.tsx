import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao, isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
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
    produto?: string
    page?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()

  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const supabase = await createClient()
  // Sync (Atualizar agora) virou admin-only. NF e importada do Omie (so leitura).
  const podeSync = await isAdmin()

  const dataInicio =
    params.data_inicio || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = params.data_final || new Date().toISOString().split('T')[0]

  // Tipo: nota_fiscal_items nao tem tipo; cruza via produtos.tipo_item -> codigo_produto -> produto_codigo do item.
  // Produto: itens cujo c_descricao_produto ou c_codigo_produto casem.
  // Ambos resolvem nota_fiscal_id distintos em nota_fiscal_items -> notas_fiscais.id in (...).
  // Resolvido ANTES da query para que lista e totais reusem o mesmo conjunto de ids.
  let notaIds: number[] | null = null
  if (params.tipo || params.produto) {
    if (params.tipo) {
      const { data: prodCodigos } = await supabase
        .from('produtos')
        .select('codigo_produto')
        .eq('loja_id', lojaId)
        .eq('tipo_item', params.tipo)

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
    .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa')
    .eq('loja_id', lojaId)
    .gte('d_emissao_nfe', dataInicio)
    .lte('d_emissao_nfe', dataFinal)
    .is('deleted_at', null)
    .order('d_emissao_nfe', { ascending: false })
    .range((page - 1) * POR_PAGINA, page * POR_PAGINA) // busca N+1 para detectar próxima
  if (params.num_nfe) query = query.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
  if (params.fornecedor) query = query.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
  // Status: espelha NotafiscalController (C = etapa 60 concluida, P = etapa diferente de 60)
  if (params.status === 'C') query = query.eq('c_etapa', '60')
  else if (params.status === 'P') query = query.neq('c_etapa', '60')
  if (idsIn) query = query.in('id', idsIn)

  // Query dos totais (mesmos filtros, sem paginacao): soma R$ + contagem do topo.
  let totaisQuery = supabase
    .from('notas_fiscais')
    .select('n_valor_nfe')
    .eq('loja_id', lojaId)
    .gte('d_emissao_nfe', dataInicio)
    .lte('d_emissao_nfe', dataFinal)
    .is('deleted_at', null)
    .limit(100000)
  if (params.num_nfe) totaisQuery = totaisQuery.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
  if (params.fornecedor) totaisQuery = totaisQuery.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
  if (params.status === 'C') totaisQuery = totaisQuery.eq('c_etapa', '60')
  else if (params.status === 'P') totaisQuery = totaisQuery.neq('c_etapa', '60')
  if (idsIn) totaisQuery = totaisQuery.in('id', idsIn)

  const [{ data: notasRaw }, { data: totaisRaw }] = await Promise.all([query, totaisQuery])
  const temProxima = (notasRaw?.length ?? 0) > POR_PAGINA
  const notas = temProxima ? notasRaw!.slice(0, POR_PAGINA) : notasRaw

  const qtdNotas = totaisRaw?.length ?? 0
  const totalValor = (totaisRaw ?? []).reduce((a, r) => a + (Number(r.n_valor_nfe) || 0), 0)

  const relatorioParams = new URLSearchParams()
  relatorioParams.set('data_inicio', dataInicio)
  relatorioParams.set('data_final', dataFinal)
  if (params.num_nfe) relatorioParams.set('num_nfe', params.num_nfe)
  if (params.fornecedor) relatorioParams.set('fornecedor', params.fornecedor)
  if (params.status) relatorioParams.set('status', params.status)
  if (params.tipo) relatorioParams.set('tipo', params.tipo)
  if (params.produto) relatorioParams.set('produto', params.produto)

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data Início' },
    { tipo: 'data', nome: 'data_final', label: 'Data Final' },
    { tipo: 'texto', nome: 'num_nfe', label: 'Nº NFe' },
    { tipo: 'texto', nome: 'fornecedor', label: 'Fornecedor' },
    {
      tipo: 'select',
      nome: 'status',
      label: 'Status',
      opcoes: [
        { value: 'P', label: 'Pendente' },
        { value: 'C', label: 'Concluída' },
      ],
    },
    { tipo: 'select', nome: 'tipo', label: 'Tipo', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'texto', nome: 'produto', label: 'Produto' },
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
                  produto: params.produto ?? '',
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
        colunas={[
          { label: 'Fornecedor', primaria: true, render: (nf) => nf.c_razao_social || nf.c_nome || '-' },
          { label: 'Emissão', larguraDesktop: 'w-28', render: (nf) => <span className="num text-text-muted">{fmtData(nf.d_emissao_nfe)}</span> },
          { label: 'NFe', larguraDesktop: 'w-28', render: (nf) => <span className="num">{nf.c_numero_nfe ?? '-'}</span> },
          { label: 'Etapa', larguraDesktop: 'w-32', render: (nf) => <StatusPill status={nf.c_etapa === '60' ? 'Concluida' : 'Pendente'} /> },
          { label: 'Valor', alinhar: 'right', larguraDesktop: 'w-32', render: (nf) => <Money value={nf.n_valor_nfe} /> },
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
        <Paginacao basePath="/nota-fiscal" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
