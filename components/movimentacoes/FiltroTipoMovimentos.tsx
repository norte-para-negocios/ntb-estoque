'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'

export function FiltroTipoMovimentos({ valorAtual }: { valorAtual: string }) {
  const router = useRouter()
  const sp = useSearchParams()

  function trocar(v: string) {
    const params = new URLSearchParams(sp.toString())
    if (v) params.set('tipo', v)
    else params.delete('tipo')
    router.push(`/movimentacoes?${params.toString()}`)
  }

  return (
    <select
      value={valorAtual}
      onChange={(e) => trocar(e.target.value)}
      className="h-8 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 text-[13px] text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40"
    >
      <option value="">Todos os tipos</option>
      {PRODUTO_TIPO_ITEM.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  )
}
