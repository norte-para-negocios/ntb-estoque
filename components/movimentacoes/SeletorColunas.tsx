'use client'

import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { btnClass } from '@/components/ui-kit/Button'

const COLUNA_OBRIGATORIA = 'Tipo' // coluna primária, nunca pode ser escondida

function chave(rota: string): string {
  return `ntb:colunas:${rota}`
}

export function useColunasVisiveis(rota: string, colunas: string[]) {
  const [visiveis, setVisiveis] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set(colunas)
    const salvo = localStorage.getItem(chave(rota))
    if (salvo) {
      try {
        const lista = JSON.parse(salvo) as string[]
        return new Set([COLUNA_OBRIGATORIA, ...lista.filter((c) => colunas.includes(c))])
      } catch {
        // ignora storage corrompido, mantem o default (todas visiveis)
      }
    }
    return new Set(colunas)
  })

  function toggle(col: string) {
    if (col === COLUNA_OBRIGATORIA) return
    setVisiveis((prev) => {
      const novo = new Set(prev)
      if (novo.has(col)) novo.delete(col)
      else novo.add(col)
      localStorage.setItem(chave(rota), JSON.stringify([...novo]))
      return novo
    })
  }

  return { visiveis, toggle }
}

export function SeletorColunas({
  colunas,
  visiveis,
  toggle,
}: {
  colunas: string[]
  visiveis: Set<string>
  toggle: (col: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button type="button" className={`${btnClass('outline')} shrink-0`}>
            <SlidersHorizontal className="size-4" /> Colunas
          </button>
        }
      />
      <SheetContent side="right" className="w-[88vw] bg-surface sm:max-w-none sm:w-[320px]" showCloseButton>
        <SheetHeader>
          <SheetTitle>Colunas visíveis</SheetTitle>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-6">
          {colunas.map((col) => (
            <label key={col} className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={visiveis.has(col)}
                disabled={col === COLUNA_OBRIGATORIA}
                onChange={() => toggle(col)}
                className="size-4 accent-[var(--brand)]"
              />
              {col}{col === COLUNA_OBRIGATORIA && <span className="text-[11px] text-text-muted"> (sempre visível)</span>}
            </label>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
