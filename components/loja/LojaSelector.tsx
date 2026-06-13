'use client'

import { useTransition } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setCurrentLoja } from '@/lib/actions/loja-selector'

type Loja = { id: number; nome_fantasia: string | null; nome: string }

export function LojaSelector({
  lojas,
  currentLojaId,
}: {
  lojas: Loja[]
  currentLojaId: number | null
}) {
  const [pending, startTransition] = useTransition()

  return (
    <Select
      value={currentLojaId ? String(currentLojaId) : undefined}
      onValueChange={(val) => startTransition(() => setCurrentLoja(Number(val)))}
      disabled={pending}
    >
      <SelectTrigger className="w-full bg-surface border-border font-medium text-text data-[placeholder]:text-text-muted">
        <SelectValue placeholder="Selecione a loja">
          {(value: string | null) => {
            const loja = lojas.find((l) => String(l.id) === value)
            return loja ? loja.nome_fantasia || loja.nome : 'Selecione a loja'
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {lojas.map((loja) => (
          <SelectItem key={loja.id} value={String(loja.id)}>
            {loja.nome_fantasia || loja.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
