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
      className="h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text outline-none transition-colors focus:border-brand"
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
