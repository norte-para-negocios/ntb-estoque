import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { NotaFiscalFiltros } from '@/components/nota-fiscal/NotaFiscalFiltros'
import { SyncButton } from '@/components/SyncButton'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { btnClass } from '@/components/ui-kit/Button'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { FileText } from 'lucide-react'

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

  const dataInicio =
    params.data_inicio || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = params.data_final || new Date().toISOString().split('T')[0]

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
  // Fornecedor: o controller original filtra por c_nome
  if (params.fornecedor) query = query.ilike('c_nome', `%${escapeIlike(params.fornecedor)}%`)

  // Status: espelha NotafiscalController (C = etapa 60 concluida, P = etapa diferente de 60)
  if (params.status === 'C') query = query.eq('c_etapa', '60')
  else if (params.status === 'P') query = query.neq('c_etapa', '60')

  // Tipo: nota_fiscal_items nao tem tipo; cruza via produtos.tipo_item -> codigo_produto -> produto_codigo do item.
  // Produto: itens cujo c_descricao_produto ou c_codigo_produto casem.
  // Ambos resolvem nota_fiscal_id distintos em nota_fiscal_items e filtram notas_fiscais.id in (...).
  if (params.tipo || params.produto) {
    if (params.tipo) {
      const { data: prodCodigos } = await supabase
        .from('produtos')
        .select('codigo_produto')
        .eq('loja_id', lojaId)
        .eq('tipo_item', params.tipo)

      const codigos = (prodCodigos ?? []).map((p) => String(p.codigo_produto))

      if (codigos.length === 0) {
        query = query.in('id', [-1])
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
        const notaIds = Array.from(
          new Set((itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v) => v != null)),
        )
        query = query.in('id', notaIds.length ? notaIds : [-1])
      }
    } else if (params.produto) {
      const p = escapeIlikeOr(params.produto)
      const { data: itemRows } = await supabase
        .from('nota_fiscal_items')
        .select('nota_fiscal_id')
        .eq('loja_id', lojaId)
        .or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
      const notaIds = Array.from(
        new Set((itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v) => v != null)),
      )
      query = query.in('id', notaIds.length ? notaIds : [-1])
    }
  }

  const { data: notasRaw } = await query
  const temProxima = (notasRaw?.length ?? 0) > POR_PAGINA
  const notas = temProxima ? notasRaw!.slice(0, POR_PAGINA) : notasRaw

  const relatorioParams = new URLSearchParams()
  relatorioParams.set('data_inicio', dataInicio)
  relatorioParams.set('data_final', dataFinal)
  if (params.num_nfe) relatorioParams.set('num_nfe', params.num_nfe)
  if (params.fornecedor) relatorioParams.set('fornecedor', params.fornecedor)
  if (params.status) relatorioParams.set('status', params.status)
  if (params.tipo) relatorioParams.set('tipo', params.tipo)
  if (params.produto) relatorioParams.set('produto', params.produto)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notas Fiscais"
        icon={FileText}
        actions={
          <>
            <a
              href={`/nota-fiscal/relatorio?${relatorioParams.toString()}`}
              target="_blank"
              rel="noopener noreferrer"
              className={btnClass('outline')}
            >
              <FileText className="size-4" /> Relatório PDF
            </a>
            <SyncButton endpoint="/api/sync/notas-fiscais" label="Atualizar agora" />
          </>
        }
      />

      <NotaFiscalFiltros
        defaults={{
          data_inicio: dataInicio,
          data_final: dataFinal,
          num_nfe: params.num_nfe ?? '',
          fornecedor: params.fornecedor ?? '',
          status: params.status ?? '',
          tipo: params.tipo ?? '',
          produto: params.produto ?? '',
        }}
      />

      {notas?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th>Emissão</th>
              <th>NFe</th>
              <th>Fornecedor</th>
              <th>Etapa</th>
              <th className="text-right">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {notas.map((nf) => (
              <tr key={nf.id}>
                <td className="num text-text-muted">{fmtData(nf.d_emissao_nfe)}</td>
                <td className="num">{nf.c_numero_nfe ?? '-'}</td>
                <td className="max-w-xs truncate">{nf.c_razao_social || nf.c_nome || '-'}</td>
                <td>
                  <StatusPill status={nf.c_etapa} />
                </td>
                <td className="text-right">
                  <Money value={nf.n_valor_nfe} />
                </td>
                <td className="text-right">
                  <Link
                    href={`/nota-fiscal/${nf.id}`}
                    className="text-brand hover:underline whitespace-nowrap"
                  >
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          icon={FileText}
          title="Nenhuma nota fiscal no período"
          hint="Sincronize com o Omie ou ajuste os filtros."
        />
      )}

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/nota-fiscal" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
