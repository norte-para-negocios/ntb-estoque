'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Warehouse } from 'lucide-react'

/** Seletor do local de estoque no topo da tela: "Todos os locais" ou um local só. Preserva os outros filtros. */
export function SeletorLocal({ basePath, locais }: { basePath: string; locais: { value: string; label: string }[] }) {
  const router = useRouter()
  const sp = useSearchParams()
  const atual = sp.get('local') ?? ''

  function trocar(value: string) {
    const p = new URLSearchParams(sp.toString())
    p.delete('page')
    if (value) p.set('local', value)
    else p.delete('local')
    const qs = p.toString()
    router.push(qs ? `${basePath}?${qs}` : basePath)
  }

  return (
    <label className="flex flex-wrap items-center gap-3 rounded-[var(--r-lg)] bg-surface px-4 py-3 u-card">
      <span className="flex items-center gap-2 text-[14px] font-semibold text-text">
        <Warehouse className="size-4 text-brand" /> Local de estoque
      </span>
      <select
        value={locais.some((l) => l.value === atual) ? atual : ''}
        onChange={(e) => trocar(e.target.value)}
        className="h-10 min-w-[220px] flex-1 rounded-[var(--r-md)] border border-[var(--border)] bg-surface-2 px-3 text-[14px] text-text sm:flex-none"
      >
        <option value="">Todos os locais</option>
        {locais.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
    </label>
  )
}
