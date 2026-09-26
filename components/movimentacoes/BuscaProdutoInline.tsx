'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

export function BuscaProdutoInline({ valorAtual }: { valorAtual: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [valor, setValor] = useState(valorAtual)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const sp = new URLSearchParams(searchParams.toString())
    const termo = valor.trim()
    if (termo) {
      sp.set('produto', termo)
      sp.set('modo', 'data')
    } else {
      sp.delete('produto')
      sp.delete('modo')
    }
    sp.delete('page')
    router.push(`/movimentacoes?${sp.toString()}`)
  }

  function limpar() {
    const sp = new URLSearchParams(searchParams.toString())
    sp.delete('produto')
    sp.delete('page')
    setValor('')
    router.push(`/movimentacoes?${sp.toString()}`)
  }

  return (
    <form onSubmit={submit} className="flex w-full items-center gap-2 sm:w-auto">
      <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Buscar produto (nome ou código)..."
          className="h-[34px] w-full rounded-[var(--r-md)] border-0 bg-surface-2 pl-9 pr-9 text-sm max-sm:h-10 max-sm:text-base text-text outline-none transition-colors placeholder:text-text-muted focus:ring-2 focus:ring-brand/40"
        />
        {valor && (
          <button
            type="button"
            onClick={limpar}
            className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface hover:text-text"
            aria-label="Limpar busca"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <button
        type="submit"
        className={`${btnClass('outline')} shrink-0`}
      >
        Ver histórico
      </button>
    </form>
  )
}
