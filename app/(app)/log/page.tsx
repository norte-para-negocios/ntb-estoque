import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import Link from 'next/link'
import { LogDetalhe } from '@/components/log/LogDetalhe'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ScrollText } from 'lucide-react'

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string; status?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  const params = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('integration_attempts')
    .select('id, model, request, response, code, error, error_message, created_at')
    .eq('loja_id', lojaId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (params.model) query = query.eq('model', params.model)
  if (params.status === 'erro') query = query.eq('error', true)
  if (params.status === 'ok') query = query.eq('error', false)

  const { data: logs } = await query

  const filtros = [
    { label: 'Todos', href: '/log', ativo: !params.status },
    { label: 'Erros', href: '/log?status=erro', ativo: params.status === 'erro' },
    { label: 'Sucesso', href: '/log?status=ok', ativo: params.status === 'ok' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Logs de Integracao com APIs"
        icon={ScrollText}
        description="Ultimas 50 tentativas de integracao"
      />

      <div className="flex gap-1.5">
        {filtros.map((f) => (
          <Link
            key={f.label}
            href={f.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              f.ativo
                ? 'bg-brand text-white'
                : 'border border-border bg-surface text-text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {logs?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th>ID</th>
              <th>Model</th>
              <th>HTTP</th>
              <th>Resultado</th>
              <th>Data</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <LogDetalhe key={log.id} log={log} />
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState icon={ScrollText} title="Nenhum log de integracao" hint="As tentativas de integracao aparecerao aqui." />
      )}
    </div>
  )
}
