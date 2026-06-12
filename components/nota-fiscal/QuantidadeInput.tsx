'use client'

import { useState, useTransition } from 'react'
import { Input } from '@/components/ui/input'
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
      toast.error('Quantidade invalida')
      return
    }
    startTransition(async () => {
      await setQuantidadeNFItem(itemId, num)
      toast.success('Quantidade salva')
    })
  }

  return (
    <Input
      type="number"
      min={0}
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={salvar}
      disabled={pending}
      className="text-right"
      placeholder="0"
    />
  )
}
