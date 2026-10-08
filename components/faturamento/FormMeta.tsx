'use client'

import { useState, useTransition } from 'react'
import { salvarMetaFaturamento } from '@/lib/actions/meta-faturamento'

export function FormMeta({ valorInicial }: { valorInicial: number | null }) {
  const [valor, setValor] = useState(valorInicial != null ? String(valorInicial).replace('.', ',') : '')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function salvar() {
    const n = Number(valor.replace(/\./g, '').replace(',', '.'))
    start(async () => {
      const r = await salvarMetaFaturamento(n)
      setMsg('error' in r ? r.error : 'Meta salva')
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <label className="flex flex-col gap-1 text-[13px] text-text-muted">
        Meta diária de faturamento (R$)
        <input
          inputMode="decimal"
          value={valor}
          onChange={(e) => { setValor(e.target.value); setMsg(null) }}
          placeholder="Ex.: 5000,00"
          className="h-9 w-44 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text"
        />
      </label>
      <button type="button" onClick={salvar} disabled={pending || valor.trim() === ''} className="h-9 rounded-full bg-brand-fill px-4 text-[13px] font-semibold text-white disabled:opacity-50">
        {pending ? 'Salvando…' : 'Salvar meta'}
      </button>
      {msg && <span className="pb-2 text-[13px] text-text-muted" role="status">{msg}</span>}
    </div>
  )
}
