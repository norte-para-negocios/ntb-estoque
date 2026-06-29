'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Search, X } from 'lucide-react'

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
    <form onSubmit={submit} className="flex items-center gap-2">
      <div className="relative flex-1 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Buscar produto (nome ou código)..."
          className="num w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-8 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand"
        />
        {valor && (
          <button
            type="button"
            onClick={limpar}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted transition-colors hover:text-text"
            aria-label="Limpar busca"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <button
        type="submit"
        className="shrink-0 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
      >
        Ver histórico
      </button>
    </form>
  )
}
