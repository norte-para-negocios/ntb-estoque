'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { StatusPill } from '@/components/ui-kit/StatusPill'

function formatar(raw: string | null): string {
  if (!raw) return '-'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export type LogRowData = {
  id: number
  model: string | null
  code: number | null
  error: boolean | null
  error_message: string | null
  created_at: string
  request: string | null
  response: string | null
}

export function LogDetalhe({ log }: { log: LogRowData }) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <tr className="cursor-pointer" onClick={() => setAberto((a) => !a)}>
        <td className="num text-text-muted">#{log.id}</td>
        <td className="font-medium text-text">{log.model || '-'}</td>
        <td className="num text-text-muted">{log.code ? `HTTP ${log.code}` : '-'}</td>
        <td>
          <StatusPill status={log.error ? 'Erro' : 'OK'} />
        </td>
        <td className="num text-text-muted whitespace-nowrap">
          {new Date(log.created_at).toLocaleString('pt-BR')}
        </td>
        <td className="text-right">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
            {aberto ? 'Ocultar' : 'Detalhes'}
            <ChevronDown
              className={`size-3.5 transition-transform ${aberto ? 'rotate-180' : ''}`}
            />
          </span>
        </td>
      </tr>
      {aberto && (
        <tr className="!bg-surface-2/40 hover:!bg-surface-2/40">
          <td colSpan={6} className="!py-3">
            {log.error_message && (
              <p className="mb-2 text-sm text-[var(--err)]">{log.error_message}</p>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                  Requisição
                </div>
                <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface p-2 text-xs text-text">
                  {formatar(log.request)}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                  Resposta
                </div>
                <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface p-2 text-xs text-text">
                  {formatar(log.response)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
