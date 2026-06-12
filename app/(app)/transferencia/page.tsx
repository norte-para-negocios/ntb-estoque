import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NovaTransferencia } from '@/components/transferencia/NovaTransferencia'

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'Concluido') return 'default'
  if (status === 'Processando no Omie') return 'secondary'
  return 'destructive'
}

export default async function TransferenciaPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Transferencias - Criar')

  const { data: transferencias } = await supabase
    .from('transferencias')
    .select('id, data, codigo_local_origem, codigo_local_destino, status, movimentos(count)')
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
        <h1 className="text-2xl font-bold">Transferências</h1>
        {podeCriar && <NovaTransferencia locais={locais ?? []} />}
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Data</th>
              <th className="text-left p-3 font-medium">Origem</th>
              <th className="text-left p-3 font-medium">Destino</th>
              <th className="text-right p-3 font-medium">Itens</th>
              <th className="text-center p-3 font-medium">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {transferencias?.length ? (
              transferencias.map((t) => {
                const count = Array.isArray(t.movimentos) ? t.movimentos[0]?.count ?? 0 : 0
                return (
                  <tr key={t.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">{new Date(t.data).toLocaleDateString('pt-BR')}</td>
                    <td className="p-3">
                      {localMap.get(t.codigo_local_origem) || t.codigo_local_origem}
                    </td>
                    <td className="p-3">
                      {localMap.get(t.codigo_local_destino) || t.codigo_local_destino}
                    </td>
                    <td className="p-3 text-right">{count}</td>
                    <td className="p-3 text-center">
                      <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/transferencia/${t.id}/contagem`}
                        className="text-blue-600 hover:underline"
                      >
                        {t.status === 'Concluido' ? 'Ver' : 'Contar'}
                      </Link>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500">
                  Nenhuma transferência. Crie uma nova para começar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
