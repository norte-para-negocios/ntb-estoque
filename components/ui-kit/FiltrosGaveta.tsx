'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SlidersHorizontal } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { btnClass } from './Button'
import type { CampoFiltro } from './Filtros'

export type { CampoFiltro }

const field =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none transition-colors focus:border-brand'
const lab = 'mb-1 block text-[11px] font-medium text-text-muted'

export function FiltrosGaveta({
  basePath,
  campos,
  defaults,
  naoContar = [],
}: {
  basePath: string
  campos: CampoFiltro[]
  defaults: Record<string, string>
  /** Campos cujo valor não conta no badge (ex.: datas padrão). */
  naoContar?: string[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [open, setOpen] = useState(false)

  // Conta filtros ativos: campos com valor não-vazio, ignorando os excluídos.
  const ativos = campos.reduce((n, c) => {
    if (naoContar.includes(c.nome)) return n
    const v = (defaults[c.nome] ?? '').trim()
    return v ? n + 1 : n
  }, 0)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const params = new URLSearchParams(sp.toString())
    params.delete('page') // reset paginação ao filtrar
    for (const c of campos) {
      const v = ((form.get(c.nome) as string) ?? '').trim()
      if (v) params.set(c.nome, v)
      else params.delete(c.nome)
    }
    router.push(`${basePath}?${params.toString()}`)
    setOpen(false)
  }

  function limpar() {
    router.push(basePath)
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button type="button" className={`${btnClass('outline')} shrink-0`}>
            <SlidersHorizontal className="size-4" /> Filtros
            {ativos > 0 && (
              <span className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-none text-white">
                {ativos}
              </span>
            )}
          </button>
        }
      />
      <SheetContent
        side="right"
        className="w-[88vw] overflow-y-auto bg-surface p-0 sm:max-w-none sm:w-[360px]"
        showCloseButton
      >
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          Filtros
        </div>

        <form onSubmit={onSubmit} className="flex h-[calc(100%-49px)] flex-col">
          <div className="flex-1 space-y-3 px-4 py-3">
            {campos.map((c) => (
              <div key={c.nome}>
                <label htmlFor={`fg-${c.nome}`} className={lab}>
                  {c.label}
                </label>
                {c.tipo === 'select' ? (
                  <select
                    id={`fg-${c.nome}`}
                    name={c.nome}
                    defaultValue={defaults[c.nome] ?? ''}
                    className={field}
                  >
                    <option value="">Todos</option>
                    {c.opcoes.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`fg-${c.nome}`}
                    name={c.nome}
                    type={c.tipo === 'data' ? 'date' : 'text'}
                    defaultValue={defaults[c.nome] ?? ''}
                    className={field}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <button type="button" onClick={limpar} className={btnClass('ghost')}>
              Limpar
            </button>
            <button type="submit" className={btnClass('primary')}>
              Aplicar
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
