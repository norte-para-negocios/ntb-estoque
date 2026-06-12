import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { SyncButton } from '@/components/SyncButton'
import { BuscaSimples } from '@/components/BuscaSimples'

function fmtMoeda(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ProdutoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const params = await searchParams
  const supabase = await createClient()
  const podeSync = await requirePermissao(lojaId, 'Produtos - Sincronizar')

  let query = supabase
    .from('produtos')
    .select('id, codigo, descricao, descricao_familia, tipo_item, unidade, valor_unitario')
    .eq('loja_id', lojaId)
    .order('descricao')
    .limit(100)

  if (params.q) query = query.or(`descricao.ilike.%${params.q}%,codigo.ilike.%${params.q}%`)

  const { data: produtos } = await query

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Produtos</h1>
        {podeSync && <SyncButton endpoint="/api/sync/produtos" label="Sincronizar com Omie" />}
      </div>

      <BuscaSimples basePath="/produto" placeholder="Buscar por nome ou código..." defaultValue={params.q ?? ''} />

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Código</th>
              <th className="text-left p-3 font-medium">Descrição</th>
              <th className="text-left p-3 font-medium">Família</th>
              <th className="text-left p-3 font-medium">Un</th>
              <th className="text-right p-3 font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {produtos?.length ? (
              produtos.map((p) => (
                <tr key={p.id} className="border-b hover:bg-gray-50">
                  <td className="p-3">{p.codigo}</td>
                  <td className="p-3">{p.descricao}</td>
                  <td className="p-3 text-gray-600">{p.descricao_familia}</td>
                  <td className="p-3">{p.unidade}</td>
                  <td className="p-3 text-right">{fmtMoeda(p.valor_unitario)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-500">
                  Nenhum produto. Sincronize com o Omie.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
