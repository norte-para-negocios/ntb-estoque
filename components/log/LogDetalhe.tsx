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
        <div className="mb-3 rounded-[var(--r-md)] bg-surface px-3 py-2.5 shadow-[var(--shadow-sm)]">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-text">
            <span
              className={`size-2 shrink-0 rounded-full ${
                exp.tipo === 'acao' ? 'bg-err' : exp.tipo === 'transitorio' ? 'bg-warn' : 'bg-text-muted'
              }`}
            />
            {exp.titulo}
          </div>
          <div className="mt-0.5 text-[13px] text-text">{exp.explicacao}</div>
        </div>
      )}
      <div className="mb-1.5 text-[13px] font-semibold text-text-muted">
        Detalhes técnicos
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[13px] font-medium text-text-muted">
            Requisição
          </div>
          <pre className="max-h-64 overflow-auto rounded-[var(--r-md)] bg-surface p-3 font-mono text-[12px] leading-relaxed text-text shadow-[var(--shadow-sm)]">
            {formatar(log.request)}
          </pre>
        </div>
        <div>
          <div className="mb-1 text-[13px] font-medium text-text-muted">
            Resposta
          </div>
          <pre className="max-h-64 overflow-auto rounded-[var(--r-md)] bg-surface p-3 font-mono text-[12px] leading-relaxed text-text shadow-[var(--shadow-sm)]">
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
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand">
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

// Linha compacta (mobile), estilo extrato, com detalhe expansível.
export function LogCard({ log }: { log: LogRowData }) {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium text-text">{log.model || '-'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-none text-text-muted">
            <span className="num">#{log.id}</span>
            <span className="num">
              {new Date(log.created_at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}
            </span>
            {log.code != null && <span className="num">HTTP {log.code}</span>}
          </div>
        </div>
        <StatusPill status={log.error ? 'Erro' : 'OK'} />
        <ChevronDown
          className={`size-4 shrink-0 text-text-muted transition-transform ${aberto ? 'rotate-180' : ''}`}
        />
      </button>
      {aberto && (
        <div className="mt-3">
          <Detalhe log={log} />
        </div>
      )}
    </div>
  )
}
