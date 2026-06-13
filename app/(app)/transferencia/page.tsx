import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftRight, Pencil } from 'lucide-react'
import { NovaTransferencia } from '@/components/transferencia/NovaTransferencia'
import { AcoesTransferencia } from '@/components/transferencia/AcoesTransferencia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'

export default async function TransferenciaPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Transferencias - Criar')
  const podeExcluir = await requirePermissao(lojaId, 'Transferencias - Excluir')

  const { data: transferencias } = await supabase
    .from('transferencias')
    .select(
      'id, data, codigo_local_origem, codigo_local_destino, status, finalizado, movimentos(count), movStatus:movimentos(status)'
    )
    .eq('loja_id', lojaId)
    .order('data', { ascending: false })
    .limit(50)

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .neq('inativo', 'S')
    .order('descricao')

  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  function fmtData(d: string | null): string {
    if (!d) return ''
    return new Date(d).toLocaleDateString('pt-BR')
  }

  return (
    <div>
      <PageHeader
        title="Transferências"
        icon={ArrowLeftRight}
        description="Movimentações entre locais de estoque"
        actions={podeCriar ? <NovaTransferencia locais={locais ?? []} /> : undefined}
      />

      {transferencias?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th>Estoque</th>
              <th>Data</th>
              <th>Local</th>
              <th className="text-right">Produtos</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transferencias.map((t) => {
              const count = Array.isArray(t.movimentos) ? t.movimentos[0]?.count ?? 0 : 0
              const movStatus = Array.isArray(t.movStatus) ? t.movStatus : []
              const temErro = movStatus.some(
                (m: { status: string | null }) => m.status === 'Erro'
              )
              const concluido = t.status === 'Concluido'
              const origem = localMap.get(t.codigo_local_origem) || t.codigo_local_origem
              const destino = localMap.get(t.codigo_local_destino) || t.codigo_local_destino
              return (
                <tr key={t.id}>
                  <td className="num font-medium text-text">#{t.id}</td>
                  <td className="num text-text-muted">{fmtData(t.data)}</td>
                  <td className="max-w-xs truncate text-text">
                    {origem} {' → '} {destino}
                  </td>
                  <td className="text-right">
                    <span className="num">{count}</span>
                  </td>
                  <td>
                    <StatusPill status={t.status} />
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/transferencia/${t.id}/contagem`}
                        className={btnClass('outline')}
                      >
                        <Pencil className="size-4" /> {concluido ? 'Ver' : 'Contar'}
                      </Link>
                      <AcoesTransferencia
                        transferenciaId={t.id}
                        temErro={temErro}
                        podeExcluir={podeExcluir}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          icon={ArrowLeftRight}
          title="Nenhuma transferência"
          hint="Crie uma nova para começar."
        />
      )}
    </div>
  )
}
