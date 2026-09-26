'use client'

import { useRouter, useSearchParams } from 'next/navigation'

type Local = { codigo_local_estoque: number; descricao: string | null }

export function FiltroLocalMovimentos({ locais, valorAtual }: { locais: Local[]; valorAtual: string }) {
  const router = useRouter()
  const sp = useSearchParams()

  function trocar(v: string) {
    const params = new URLSearchParams(sp.toString())
    if (v) params.set('local', v)
    else params.delete('local')
    router.push(`/movimentacoes?${params.toString()}`)
  }

  return (
    <select
      value={valorAtual}
      onChange={(e) => trocar(e.target.value)}
      className="h-8 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 text-[13px] text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40"
    >
      <option value="">Todos os locais</option>
      {locais.map((l) => (
        <option key={l.codigo_local_estoque} value={String(l.codigo_local_estoque)}>
          {l.descricao ?? l.codigo_local_estoque}
        </option>
      ))}
    </select>
  )
}
