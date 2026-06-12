import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { SyncButton } from '@/components/SyncButton'
import { BuscaSimples } from '@/components/BuscaSimples'

export default async function LocalEstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Locais de Estoque'))) notFound()

  const params = await searchParams
  const supabase = await createClient()
  const podeSync = await requirePermissao(lojaId, 'Locais de Estoque - Sincronizar')

  let query = supabase
    .from('local_estoques')
    .select('id, codigo_local_estoque, codigo, descricao, inativo')
    .eq('loja_id', lojaId)
    .order('descricao')
    .limit(200)

  if (params.q) query = query.ilike('descricao', `%${params.q}%`)

  const { data: locais } = await query

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Locais de Estoque</h1>
        {podeSync && <SyncButton endpoint="/api/sync/locais" label="Sincronizar com Omie" />}
      </div>

      <BuscaSimples basePath="/local-estoque" placeholder="Buscar local..." defaultValue={params.q ?? ''} />

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Codigo Omie</th>
              <th className="text-left p-3 font-medium">Codigo</th>
              <th className="text-left p-3 font-medium">Descricao</th>
              <th className="text-center p-3 font-medium">Ativo</th>
            </tr>
          </thead>
          <tbody>
            {locais?.length ? (
              locais.map((l) => (
                <tr key={l.id} className="border-b hover:bg-gray-50">
                  <td className="p-3">{l.codigo_local_estoque}</td>
                  <td className="p-3">{l.codigo}</td>
                  <td className="p-3">{l.descricao}</td>
                  <td className="p-3 text-center">{l.inativo === 'S' ? 'Nao' : 'Sim'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="p-8 text-center text-gray-500">
                  Nenhum local de estoque. Sincronize com o Omie.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
