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
import { btnClass } from '@/components/ui-kit/Button'
import { FileText } from 'lucide-react'

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
    produto?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()

  const params = await searchParams
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
    .limit(50)

  if (params.num_nfe) query = query.ilike('c_numero_nfe', `%${params.num_nfe}%`)
  if (params.fornecedor) query = query.ilike('c_razao_social', `%${params.fornecedor}%`)

  const { data: notas } = await query

  const relatorioParams = new URLSearchParams()
  relatorioParams.set('data_inicio', dataInicio)
  relatorioParams.set('data_final', dataFinal)
  if (params.num_nfe) relatorioParams.set('num_nfe', params.num_nfe)
  if (params.fornecedor) relatorioParams.set('fornecedor', params.fornecedor)

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
            <SyncButton endpoint="/api/sync/notas-fiscais" label="Sincronizar" />
          </>
        }
      />

      <NotaFiscalFiltros
        defaults={{
          data_inicio: dataInicio,
          data_final: dataFinal,
          num_nfe: params.num_nfe ?? '',
          fornecedor: params.fornecedor ?? '',
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
    </div>
  )
}
