'use client'

import { useRouter, useSearchParams } from 'next/navigation'

/** Tipos de movimento do estoque próprio (ledger). */
export const TIPOS_LEDGER: Record<string, { label: string; cor: string }> = {
  ENT: { label: 'Entrada', cor: 'text-ok' },
  SAI: { label: 'Saída', cor: 'text-err' },
  AJU: { label: 'Ajuste', cor: 'text-text' },
  TRF: { label: 'Transferência', cor: 'text-warn' },
  PRD: { label: 'Produção', cor: 'text-brand' },
  EST: { label: 'Estorno', cor: 'text-text-muted' },
}

export function FiltroTipoLedger({ valorAtual }: { valorAtual: string }) {
  const router = useRouter()
  const sp = useSearchParams()

  function trocar(v: string) {
    const params = new URLSearchParams(sp.toString())
    if (v) params.set('tm', v)
    else params.delete('tm')
    router.push(`/movimentacoes?${params.toString()}`)
  }

  return (
    <select
      value={valorAtual}
      onChange={(e) => trocar(e.target.value)}
      aria-label="Tipo de movimento"
      className="h-9 max-w-[220px] shrink-0 rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 text-[13px] max-sm:h-10 max-sm:text-base text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40"
    >
      <option value="">Todos os movimentos</option>
      {Object.entries(TIPOS_LEDGER).map(([v, t]) => (
        <option key={v} value={v}>
          {t.label}
        </option>
      ))}
    </select>
  )
}
