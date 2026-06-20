'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { explicarErroOmie } from '@/lib/erro-omie-amigavel'

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

function Detalhe({ log }: { log: LogRowData }) {
  const exp = explicarErroOmie(log.error_message)
  return (
    <>
      {exp && (
        <div
          className={`mb-3 rounded-md border px-3 py-2.5 ${
            exp.tipo === 'acao'
              ? 'border-err/30 bg-err/10'
              : exp.tipo === 'transitorio'
                ? 'border-warn/30 bg-warn/10'
                : 'border-border bg-surface-2/50'
          }`}
        >
          <div
            className={`text-[13px] font-semibold ${
              exp.tipo === 'acao' ? 'text-err' : exp.tipo === 'transitorio' ? 'text-warn' : 'text-text'
            }`}
          >
            {exp.titulo}
          </div>
          <div className="mt-0.5 text-[13px] text-text">{exp.explicacao}</div>
        </div>
      )}
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
        Detalhes técnicos
      </div>
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
    </>
  )
}

// Linha da tabela (desktop). Mantida para o modo tabela com detalhe expansível.
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
          {new Date(log.created_at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}
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
            <Detalhe log={log} />
          </td>
        </tr>
      )}
    </>
  )
}

// Card (mobile) com o mesmo detalhe expansível.
export function LogCard({ log }: { log: LogRowData }) {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-text">{log.model || '-'}</div>
          <div className="num text-[11px] text-text-muted">#{log.id}</div>
        </div>
        <StatusPill status={log.error ? 'Erro' : 'OK'} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Data/hora
          </dt>
          <dd className="num text-sm text-text">
            {new Date(log.created_at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            HTTP
          </dt>
          <dd className="num text-sm text-text">{log.code ? `HTTP ${log.code}` : '-'}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand"
      >
        {aberto ? 'Ocultar detalhe' : 'Ver detalhe'}
        <ChevronDown className={`size-3.5 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div className="mt-3">
          <Detalhe log={log} />
        </div>
      )}
    </div>
  )
}
