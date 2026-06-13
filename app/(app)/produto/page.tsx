import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { SyncButton } from '@/components/SyncButton'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Filtros } from '@/components/ui-kit/Filtros'
import { Money } from '@/components/ui-kit/Money'
import { PRODUTO_TIPO_ITEM, labelTipoItem } from '@/lib/constants-omie'
import { Package } from 'lucide-react'

export default async function ProdutoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; familia?: string; tipo?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const params = await searchParams
  const supabase = await createClient()
  const podeSync = await requirePermissao(lojaId, 'Produtos - Sincronizar')

  // Famílias distintas da loja para o select de filtro
  const { data: familiasRows } = await supabase
    .from('produtos')
    .select('descricao_familia')
    .eq('loja_id', lojaId)
    .not('descricao_familia', 'is', null)
    .order('descricao_familia')

  const familiasOpcoes = Array.from(
    new Set((familiasRows ?? []).map((r) => r.descricao_familia).filter(Boolean) as string[]),
  ).map((f) => ({ value: f, label: f }))

  let query = supabase
    .from('produtos')
    .select('id, codigo, descricao, descricao_familia, tipo_item, unidade, valor_unitario')
    .eq('loja_id', lojaId)
    .order('descricao')
    .limit(100)

  if (params.q) query = query.or(`descricao.ilike.%${params.q}%,codigo.ilike.%${params.q}%`)
  if (params.familia) query = query.eq('descricao_familia', params.familia)
  if (params.tipo) query = query.eq('tipo_item', params.tipo)

  const { data: produtos } = await query

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produtos"
        icon={Package}
        actions={podeSync ? <SyncButton endpoint="/api/sync/produtos" label="Sincronizar" /> : undefined}
      />

      <Filtros
        basePath="/produto"
        campos={[
          { tipo: 'texto', nome: 'q', label: 'Nome ou código' },
          { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes },
          { tipo: 'select', nome: 'tipo', label: 'Tipo', opcoes: PRODUTO_TIPO_ITEM },
        ]}
        defaults={{
          q: params.q ?? '',
          familia: params.familia ?? '',
          tipo: params.tipo ?? '',
        }}
      />

      {produtos?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Família</th>
              <th>Tipo</th>
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
                <td className="text-text-muted">{labelTipoItem(p.tipo_item)}</td>
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
