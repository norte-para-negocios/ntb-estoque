'use client'

import { useState, useTransition } from 'react'
import { Minus, Plus } from 'lucide-react'
import { setQuantidadeNFItem } from '@/lib/actions/nota-fiscal'
import { parseNumBR } from '@/lib/num-br'
import { toast } from 'sonner'

export function QuantidadeInput({
  itemId,
  valorInicial,
}: {
  itemId: number
  valorInicial: number | null
}) {
  const [valor, setValor] = useState<string>(valorInicial != null ? String(valorInicial) : '')
  const [pending, startTransition] = useTransition()

  function salvar(v: string) {
    const num = parseNumBR(v)
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade inválida')
      return
    }
    startTransition(async () => {
      await setQuantidadeNFItem(itemId, num)
      toast.success('Quantidade salva')
    })
  }

  function ajustar(delta: number) {
    const atual = parseNumBR(valor) ?? 0
    const novo = Math.max(0, (Number.isNaN(atual) ? 0 : atual) + delta)
    const str = String(novo)
    setValor(str)
    salvar(str)
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => ajustar(-1)}
        disabled={pending}
        className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:bg-surface-2 disabled:opacity-60 lg:size-8"
        aria-label="Diminuir"
      >
        <Minus className="size-4" />
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => salvar(valor)}
        onWheel={(e) => e.currentTarget.blur()}
        disabled={pending}
        placeholder="0"
        className="h-11 w-16 rounded-md border border-border bg-surface px-2 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60 lg:h-8"
      />
      <button
        type="button"
        onClick={() => ajustar(1)}
        disabled={pending}
        className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:bg-surface-2 disabled:opacity-60 lg:size-8"
        aria-label="Aumentar"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
