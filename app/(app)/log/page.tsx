import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LogDetalhe } from '@/components/log/LogDetalhe'

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Logs de Integração</h1>

      <div className="flex gap-2 text-sm">
        <a href="/log" className="px-3 py-1 rounded border hover:bg-gray-50">Todos</a>
        <a href="/log?status=erro" className="px-3 py-1 rounded border hover:bg-gray-50">Erros</a>
        <a href="/log?status=ok" className="px-3 py-1 rounded border hover:bg-gray-50">Sucesso</a>
      </div>

      <div className="space-y-2">
        {logs?.length ? (
          logs.map((log) => (
            <Card key={log.id} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Badge variant={log.error ? 'destructive' : 'default'}>
                    {log.error ? 'Erro' : 'OK'}
                  </Badge>
                  <span className="font-medium">{log.model}</span>
                  <span className="text-sm text-gray-500">
                    {new Date(log.created_at).toLocaleString('pt-BR')}
                  </span>
                  {log.code && <span className="text-xs text-gray-400">HTTP {log.code}</span>}
                </div>
              </div>
              {log.error_message && (
                <p className="text-sm text-red-600 mt-2">{log.error_message}</p>
              )}
              <LogDetalhe request={log.request} response={log.response} />
            </Card>
          ))
        ) : (
          <Card className="p-8 text-center text-gray-500">Nenhum log de integração.</Card>
        )}
      </div>
    </div>
  )
}
