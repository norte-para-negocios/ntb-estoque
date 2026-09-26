'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export function FiltroFamiliaMovimentos({ familias, valorAtual }: { familias: string[]; valorAtual: string }) {
  const router = useRouter()
  const sp = useSearchParams()

  function trocar(v: string) {
    const params = new URLSearchParams(sp.toString())
    if (v) params.set('familia', v)
    else params.delete('familia')
    router.push(`/movimentacoes?${params.toString()}`)
  }

  return (
    <select
      value={valorAtual}
      onChange={(e) => trocar(e.target.value)}
      className="h-9 max-w-[220px] shrink-0 rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 text-[13px] max-sm:h-10 max-sm:text-base text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40"
    >
      <option value="">Todas as famílias</option>
      {familias.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  )
}
