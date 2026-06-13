'use client'

import * as React from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { buscaGlobal, type BuscaItem } from '@/lib/actions/busca-global'

const GRUPOS: { tipo: BuscaItem['tipo']; titulo: string }[] = [
  { tipo: 'Produto', titulo: 'Produtos' },
  { tipo: 'Nota', titulo: 'Notas fiscais' },
  { tipo: 'OP', titulo: 'Ordens de produção' },
]

export function BuscaGlobal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [termo, setTermo] = React.useState('')
  const [itens, setItens] = React.useState<BuscaItem[]>([])
  const [carregando, setCarregando] = React.useState(false)
  const reqId = React.useRef(0)

  // Limpa o estado quando o dialog fecha.
  React.useEffect(() => {
    if (!open) {
      setTermo('')
      setItens([])
      setCarregando(false)
    }
  }, [open])

  // Debounce de 250ms sobre o termo.
  React.useEffect(() => {
    const t = termo.trim()
    if (t.length < 2) {
      setItens([])
      setCarregando(false)
      return
    }
    setCarregando(true)
    const id = ++reqId.current
    const handle = setTimeout(async () => {
      try {
        const res = await buscaGlobal(t)
        // Ignora respostas obsoletas (out of order).
        if (id === reqId.current) {
          setItens(res)
          setCarregando(false)
        }
      } catch {
        if (id === reqId.current) {
          setItens([])
          setCarregando(false)
        }
      }
    }, 250)
    return () => clearTimeout(handle)
  }, [termo])

  const fechar = () => onOpenChange(false)

  const temResultado = itens.length > 0
  const termoValido = termo.trim().length >= 2

  return (
    <Dialog open={open} onOpenChange={(o) => onOpenChange(o)}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="busca-global"
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col gap-0 overflow-hidden rounded-xl border border-border bg-surface text-text shadow-lg ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95'
          )}
        >
          <DialogPrimitive.Title className="sr-only">Busca global</DialogPrimitive.Title>

          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
            <Input
              autoFocus
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Buscar produtos, notas, ordens..."
              className="h-7 border-0 bg-transparent px-0 text-sm focus-visible:ring-0 focus-visible:border-0"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {!termoValido && (
              <p className="px-3 py-6 text-center text-sm text-text-muted">
                Digite ao menos 2 caracteres para buscar.
              </p>
            )}

            {termoValido && carregando && (
              <p className="px-3 py-6 text-center text-sm text-text-muted">Buscando...</p>
            )}

            {termoValido && !carregando && !temResultado && (
              <p className="px-3 py-6 text-center text-sm text-text-muted">
                Nenhum resultado para &quot;{termo.trim()}&quot;.
              </p>
            )}

            {termoValido && !carregando && temResultado && (
              <div className="flex flex-col">
                {GRUPOS.map(({ tipo, titulo }) => {
                  const doGrupo = itens.filter((i) => i.tipo === tipo)
                  if (doGrupo.length === 0) return null
                  return (
                    <div key={tipo} className="py-1">
                      <p className="px-3 py-1 text-xs font-medium tracking-wide text-text-muted uppercase">
                        {titulo}
                      </p>
                      <ul>
                        {doGrupo.map((item, idx) => (
                          <li key={`${tipo}-${idx}-${item.href}`}>
                            <Link
                              href={item.href}
                              onClick={fechar}
                              className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                            >
                              <span className="truncate text-text">{item.label}</span>
                              {item.sub && (
                                <span className="shrink-0 text-xs text-text-muted">{item.sub}</span>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}
