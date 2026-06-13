import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { SyncButton } from '@/components/SyncButton'
import { BuscaSimples } from '@/components/BuscaSimples'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { escapeIlike } from '@/lib/utils-busca'
import { Warehouse } from 'lucide-react'

function fmtTimestamp(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('pt-BR')
}

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

  const { data: lojaSync } = await supabase
    .from('lojas')
    .select('local_estoque_ultima_atualizacao, local_estoque_status')
    .eq('id', lojaId)
    .single()

  let query = supabase
    .from('local_estoques')
    .select('id, codigo_local_estoque, codigo, descricao, inativo')
    .eq('loja_id', lojaId)
    .order('descricao')
    .limit(200)

  if (params.q) query = query.ilike('descricao', `%${escapeIlike(params.q)}%`)

  const { data: locais } = await query

  return (
    <div className="space-y-4">
      <PageHeader
        title="Locais de Estoque"
        icon={Warehouse}
        description="Locais sincronizados do Omie"
        actions={podeSync && <SyncButton endpoint="/api/sync/locais" label="Sincronizar com Omie" />}
      />

      <div className="flex items-center gap-2 text-[13px] text-text-muted">
        <span>Atualizado em {fmtTimestamp(lojaSync?.local_estoque_ultima_atualizacao ?? null)}</span>
        <span>·</span>
        <StatusPill status={lojaSync?.local_estoque_status ?? null} />
      </div>

      <BuscaSimples
        basePath="/local-estoque"
        placeholder="Buscar local..."
        defaultValue={params.q ?? ''}
      />

      {locais?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Código Local Estoque</th>
              <th>Código</th>
              <th className="text-right">Situação</th>
            </tr>
          </thead>
          <tbody>
            {locais.map((l) => (
              <tr key={l.id}>
                <td className="font-medium text-text">{l.descricao || '-'}</td>
                <td className="num text-text-muted">{l.codigo_local_estoque || '-'}</td>
                <td className="num text-text-muted">{l.codigo || '-'}</td>
                <td className="text-right">
                  <StatusPill status={l.inativo === 'S' ? 'Inativo' : 'Ativo'} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          icon={Warehouse}
          title="Nenhum local de estoque"
          hint="Sincronize com o Omie para ver os locais."
        />
      )}
    </div>
  )
}
