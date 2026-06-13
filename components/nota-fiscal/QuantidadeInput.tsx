'use client'

import { useState, useTransition } from 'react'
import { Minus, Plus } from 'lucide-react'
import { setQuantidadeNFItem } from '@/lib/actions/nota-fiscal'
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
    const num = v === '' ? null : Number(v)
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
    const atual = valor === '' ? 0 : Number(valor) || 0
    const novo = Math.max(0, atual + delta)
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
        className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
        aria-label="Diminuir"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        min={0}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => salvar(valor)}
        disabled={pending}
        placeholder="0"
        className="w-16 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60"
      />
      <button
        type="button"
        onClick={() => ajustar(1)}
        disabled={pending}
        className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
        aria-label="Aumentar"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}
