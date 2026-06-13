import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import Link from 'next/link'
import { LogDetalhe } from '@/components/log/LogDetalhe'
import { ScrollText, ArrowLeft } from 'lucide-react'

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
      {/* Título estilo original: voltar + ícone + nome */}
      <div className="flex items-center gap-2">
        <Link href="/home" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
          <ArrowLeft className="size-5" strokeWidth={2} />
        </Link>
        <ScrollText className="size-5 text-[#2eb5c3]" strokeWidth={2} />
        <h1 className="text-lg font-semibold text-[#5d5d5d]">Logs de Integracao com APIs</h1>
      </div>

      <div className="flex gap-2">
        {filtros.map((f) => (
          <Link
            key={f.label}
            href={f.href}
            className={f.ativo ? 'ntb-btn-teal' : 'ntb-btn-outline'}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Lista de cards empilhados (fiel ao original) */}
      <div className="space-y-4">
        {logs?.length ? (
          logs.map((log) => (
            <div key={log.id} className="ntb-card">
              <div className="ntb-card-header flex items-center justify-between gap-3">
                <span>
                  #{log.id} {log.model ? `- ${log.model}` : ''}
                </span>
                <span className="flex items-center gap-2 text-sm font-normal text-white/90">
                  {log.code ? `HTTP ${log.code}` : ''}
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      log.error ? 'bg-[#ff595e] text-white' : 'bg-[#2bd84a] text-white'
                    }`}
                  >
                    {log.error ? 'Erro' : 'OK'}
                  </span>
                </span>
              </div>
              <div className="ntb-card-body">
                <small className="text-[#8a8a8a]">Data</small>
                <p className="font-semibold text-[#5d5d5d]">
                  {new Date(log.created_at).toLocaleString('pt-BR')}
                </p>
                {log.error_message && (
                  <p className="mt-2 text-sm text-[#ff595e]">{log.error_message}</p>
                )}
                <LogDetalhe request={log.request} response={log.response} />
              </div>
            </div>
          ))
        ) : (
          <div className="ntb-card">
            <div className="ntb-card-body text-center text-[#8a8a8a]">
              Nenhum log de integracao.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
