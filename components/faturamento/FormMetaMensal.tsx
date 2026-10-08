'use client'

import { useState, useTransition } from 'react'
import { salvarMetaMensal } from '@/lib/actions/meta-mensal'
import { parseValorBR } from '@/lib/meta-faturamento'

// Campo da meta do mes. Nasce vazio: quem define o valor e' o cliente.
export function FormMetaMensal({ mes, valorInicial, rotuloMes }: { mes: string; valorInicial: number | null; rotuloMes: string }) {
  const [valor, setValor] = useState(valorInicial != null ? String(valorInicial).replace('.', ',') : '')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function salvar() {
    start(async () => {
      const r = await salvarMetaMensal(mes, parseValorBR(valor))
      setMsg('error' in r ? r.error : 'Meta salva')
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <label className="flex flex-col gap-1 text-[13px] text-text-muted">
        Meta de faturamento de {rotuloMes} (R$)
        <input
          inputMode="decimal"
          value={valor}
          onChange={(e) => { setValor(e.target.value); setMsg(null) }}
          placeholder="Digite a meta do mês"
          className="h-9 w-56 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text"
        />
      </label>
      <button type="button" onClick={salvar} disabled={pending || valor.trim() === ''} className="h-9 rounded-full bg-brand-fill px-4 text-[13px] font-semibold text-white disabled:opacity-50">
        {pending ? 'Salvando…' : 'Salvar meta'}
      </button>
      {msg && <span className="pb-2 text-[13px] text-text-muted" role="status">{msg}</span>}
    </div>
  )
}
