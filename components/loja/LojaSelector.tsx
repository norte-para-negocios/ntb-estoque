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
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Selecione a loja" />
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
