'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Store } from 'lucide-react'
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

  // Quem so tem 1 loja (ou nenhuma) nao ve o dropdown: mostra apenas o nome da
  // loja num bloco estatico, pra nao revelar que existem outras lojas.
  if (lojas.length <= 1) {
    const unica = lojas[0]
    return (
      <div className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text">
        <Store className="size-4 shrink-0 text-text-muted" aria-hidden />
        <span className="truncate">
          {unica ? unica.nome_fantasia || unica.nome : 'Nenhuma loja'}
        </span>
      </div>
    )
  }

  return (
    <Select
      value={currentLojaId ? String(currentLojaId) : undefined}
      onValueChange={(val) =>
        startTransition(async () => {
          const res = await setCurrentLoja(Number(val))
          if (res?.error) toast.error('Erro', { description: res.error })
        })
      }
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
