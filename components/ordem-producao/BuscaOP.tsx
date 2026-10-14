'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

/** Barra de pesquisa da lista de OPs: grava ?q= mantendo os outros filtros (e volta para a página 1). */
export function BuscaOP({ valorAtual }: { valorAtual: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const [valor, setValor] = useState(valorAtual)

  function ir(q: string) {
    const p = new URLSearchParams(sp.toString())
    if (q) p.set('q', q)
    else p.delete('q')
    p.delete('page')
    router.push(`/ordem-producao${p.size ? `?${p}` : ''}`)
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); ir(valor.trim()) }} className="flex w-full items-center gap-2 lg:max-w-2xl">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Buscar OP: número, produto, cupom/observação ou data (dd/mm)"
          aria-label="Buscar ordem de produção"
          className="h-9 w-full rounded-[var(--r-md)] border-0 bg-surface-2 pl-9 pr-9 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:ring-2 focus:ring-brand/40 max-sm:h-10 max-sm:text-base"
        />
        {valor && (
          <button type="button" onClick={() => { setValor(''); ir('') }} aria-label="Limpar busca"
            className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-text-muted hover:bg-surface hover:text-text">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <button type="submit" className={`${btnClass('primary')} shrink-0`}>Buscar</button>
    </form>
  )
}
