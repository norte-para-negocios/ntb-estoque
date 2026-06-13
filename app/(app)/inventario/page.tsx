import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NovoInventario } from '@/components/inventario/NovoInventario'
import { AcoesInventario } from '@/components/inventario/AcoesInventario'

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'Finalizado') return 'default'
  if (status === 'Processando no Omie') return 'secondary'
  return 'destructive'
}

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Inventários</h1>
        {podeCriar && <NovoInventario locais={locais ?? []} />}
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Data</th>
              <th className="text-left p-3 font-medium">Local</th>
              <th className="text-right p-3 font-medium">Itens</th>
              <th className="text-center p-3 font-medium">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {inventarios?.length ? (
              inventarios.map((inv) => {
                const count = Array.isArray(inv.items) ? inv.items[0]?.count ?? 0 : 0
                const itensStatus = Array.isArray(inv.itensStatus) ? inv.itensStatus : []
                const temErro = itensStatus.some(
                  (i: { status: string | null }) =>
                    i.status === 'Erro' || i.status === 'Sem CMC'
                )
                return (
                  <tr key={inv.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">{new Date(inv.data).toLocaleDateString('pt-BR')}</td>
                    <td className="p-3">
                      {localMap.get(inv.codigo_local_estoque) || inv.codigo_local_estoque}
                    </td>
                    <td className="p-3 text-right">{count}</td>
                    <td className="p-3 text-center">
                      <Badge variant={statusVariant(inv.status)}>{inv.status}</Badge>
                    </td>
                    <td className="p-3 text-right">
                      <span className="inline-flex items-center gap-4">
                        <Link
                          href={`/inventario/${inv.id}/contagem`}
                          className="text-blue-600 hover:underline"
                        >
                          {inv.status === 'Finalizado' ? 'Ver' : 'Contar'}
                        </Link>
                        <AcoesInventario
                          inventarioId={inv.id}
                          temErro={temErro}
                          podeExcluir={podeExcluir}
                        />
                      </span>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-500">
                  Nenhum inventário. Crie um novo para começar a contagem.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
