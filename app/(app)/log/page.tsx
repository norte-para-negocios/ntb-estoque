import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, isAdmin } from '@/lib/auth'
import Link from 'next/link'
import { LogDetalhe } from '@/components/log/LogDetalhe'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Filtros, type CampoFiltro } from '@/components/ui-kit/Filtros'
import { ScrollText } from 'lucide-react'

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{
    model?: string
    status?: string
    data_inicio?: string
    data_final?: string
    loja_id?: string
    code?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  const admin = await isAdmin()
  const params = await searchParams
  const supabase = await createClient()

  // Loja base: usuario fica restrito a sua loja atual.
  // Admin pode filtrar por qualquer loja via select loja_id.
  const lojaFiltro = admin && params.loja_id ? Number(params.loja_id) : lojaId

  let query = supabase
    .from('integration_attempts')
    .select('id, model, request, response, code, error, error_message, created_at')
    .eq('loja_id', lojaFiltro)
    .order('created_at', { ascending: false })
    .limit(50)

  if (params.model) query = query.eq('model', params.model)
  if (params.status === 'erro') query = query.eq('error', true)
  if (params.status === 'ok') query = query.eq('error', false)
  if (params.code) query = query.eq('code', params.code)
  if (params.data_inicio) query = query.gte('created_at', params.data_inicio)
  if (params.data_final) query = query.lte('created_at', `${params.data_final} 23:59:59`)

  const { data: logs } = await query

  // Opcoes de model: distintos das tentativas da loja em escopo.
  const { data: modelRows } = await supabase
    .from('integration_attempts')
    .select('model')
    .eq('loja_id', lojaFiltro)
    .not('model', 'is', null)
  const modelsDistintos = Array.from(
    new Set((modelRows ?? []).map((r) => r.model as string).filter(Boolean))
  ).sort()

  // Opcoes de loja apenas para admin.
  const { data: lojas } = admin
    ? await supabase.from('lojas').select('id, nome, nome_fantasia').order('nome_fantasia')
    : { data: null }

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicio' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    ...(admin && lojas?.length
      ? ([
          {
            tipo: 'select',
            nome: 'loja_id',
            label: 'Loja',
            opcoes: lojas.map((l) => ({
              value: String(l.id),
              label: l.nome_fantasia || l.nome,
            })),
          },
        ] as CampoFiltro[])
      : []),
    {
      tipo: 'select',
      nome: 'model',
      label: 'Model',
      opcoes: modelsDistintos.map((m) => ({ value: m, label: m })),
    },
    { tipo: 'texto', nome: 'code', label: 'HTTP code' },
    {
      tipo: 'select',
      nome: 'status',
      label: 'Resultado',
      opcoes: [
        { value: 'erro', label: 'Erro' },
        { value: 'ok', label: 'OK' },
      ],
    },
  ]

  const defaults: Record<string, string> = {
    data_inicio: params.data_inicio ?? '',
    data_final: params.data_final ?? '',
    loja_id: params.loja_id ?? '',
    model: params.model ?? '',
    code: params.code ?? '',
    status: params.status ?? '',
  }

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

      <Filtros basePath="/log" campos={campos} defaults={defaults} />

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
