import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, Pencil } from 'lucide-react'
import { NovoInventario } from '@/components/inventario/NovoInventario'
import { AcoesInventario } from '@/components/inventario/AcoesInventario'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'

export default async function InventarioPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Inventarios - Criar')
  const podeExcluir = await requirePermissao(lojaId, 'Inventarios - Excluir')

  const { data: inventarios } = await supabase
    .from('inventarios')
    .select(
      'id, data, codigo_local_estoque, status, finalizado, items:inventario_items(count), itensStatus:inventario_items(status)'
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
        title="Inventários"
        icon={ClipboardList}
        description="Contagens de estoque por local"
        actions={podeCriar ? <NovoInventario locais={locais ?? []} /> : undefined}
      />

      {inventarios?.length ? (
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
            {inventarios.map((inv) => {
              const count = Array.isArray(inv.items) ? inv.items[0]?.count ?? 0 : 0
              const itensStatus = Array.isArray(inv.itensStatus) ? inv.itensStatus : []
              const temErro = itensStatus.some(
                (i: { status: string | null }) => i.status === 'Erro' || i.status === 'Sem CMC'
              )
              const finalizado = inv.status === 'Finalizado'
              const local = localMap.get(inv.codigo_local_estoque) || inv.codigo_local_estoque
              return (
                <tr key={inv.id}>
                  <td className="num font-medium text-text">#{inv.id}</td>
                  <td className="num text-text-muted">{fmtData(inv.data)}</td>
                  <td className="max-w-xs truncate text-text">{local}</td>
                  <td className="text-right">
                    <span className="num">{count}</span>
                  </td>
                  <td>
                    <StatusPill status={inv.status} />
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/inventario/${inv.id}/contagem`}
                        className={btnClass('outline')}
                      >
                        <Pencil className="size-4" /> {finalizado ? 'Ver' : 'Contar'}
                      </Link>
                      <AcoesInventario
                        inventarioId={inv.id}
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
          icon={ClipboardList}
          title="Nenhum inventário"
          hint="Crie um novo para começar a contagem."
        />
      )}
    </div>
  )
}
