'use client'

import { useState, useTransition } from 'react'
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

  function salvar() {
    const num = valor === '' ? null : Number(valor)
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade inválida')
      return
    }
    startTransition(async () => {
      await setQuantidadeNFItem(itemId, num)
      toast.success('Quantidade salva')
    })
  }

  return (
    <input
      type="number"
      min={0}
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={salvar}
      disabled={pending}
      placeholder="0"
      className="w-24 rounded-md border border-border bg-surface px-2.5 py-1.5 text-right text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60"
    />
  )
}
