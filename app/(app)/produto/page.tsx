import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { SyncButton } from '@/components/SyncButton'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Toolbar } from '@/components/ui-kit/Toolbar'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { Package, Search } from 'lucide-react'

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
    <div className="space-y-4">
      <PageHeader
        title="Produtos"
        icon={Package}
        actions={podeSync ? <SyncButton endpoint="/api/sync/produtos" label="Sincronizar" /> : undefined}
      />

      <Toolbar>
        <form method="GET" action="/produto" className="flex items-end gap-2">
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Pesquisar por nome ou código"
            className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none transition-colors focus:border-brand"
          />
          <button type="submit" className={btnClass('primary')}>
            <Search className="size-4" /> Pesquisar
          </button>
        </form>
      </Toolbar>

      {produtos?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Família</th>
              <th>Unidade</th>
              <th className="text-right">Valor unitário</th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => (
              <tr key={p.id}>
                <td className="num text-text-muted">{p.codigo || '-'}</td>
                <td className="max-w-md truncate font-medium text-text">{p.descricao}</td>
                <td className="text-text-muted">{p.descricao_familia || '-'}</td>
                <td className="text-text-muted">{p.unidade || '-'}</td>
                <td className="text-right">
                  <Money value={p.valor_unitario} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          icon={Package}
          title="Nenhum produto"
          hint="Sincronize com o Omie ou ajuste a busca."
        />
      )}
    </div>
  )
}
