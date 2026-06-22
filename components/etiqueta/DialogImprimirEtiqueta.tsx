'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Printer } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

const LS_LC = 'etq_lc'
const LS_AC = 'etq_ac'
const inputClass = 'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text num outline-none focus:border-brand'

// Diálogo de impressão de etiqueta: o usuário escolhe o TAMANHO em cm (ou usa o
// padrão da loja). Só o tamanho é do usuário; o resto (campos, cor, nome) é o
// padrão definido pelo admin em Minha loja. A escolha fica lembrada no navegador.
export function DialogImprimirEtiqueta({
  href,
  label = 'Imprimir',
  trigger,
}: {
  href: string
  label?: string
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [personalizar, setPersonalizar] = useState(false)
  const [lc, setLc] = useState('7.26')
  const [ac, setAc] = useState('4.0')

  function onOpenChange(v: boolean) {
    if (v) {
      try {
        const sLc = localStorage.getItem(LS_LC)
        const sAc = localStorage.getItem(LS_AC)
        if (sLc && sAc) {
          setLc(sLc)
          setAc(sAc)
          setPersonalizar(true)
        }
      } catch {}
    }
    setOpen(v)
  }

  function imprimir() {
    const u = new URL(href, window.location.origin)
    if (personalizar) {
      const l = Number(lc)
      const a = Number(ac)
      if (l >= 2 && l <= 30 && a >= 2 && a <= 30) {
        u.searchParams.set('lc', String(l))
        u.searchParams.set('ac', String(a))
        try {
          localStorage.setItem(LS_LC, String(l))
          localStorage.setItem(LS_AC, String(a))
        } catch {}
      }
    }
    window.open(u.toString(), '_blank', 'noopener')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          (trigger as React.ReactElement) ?? (
            <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text">
              <Printer className="size-3.5" strokeWidth={2} /> {label}
            </button>
          )
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-sm" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">Imprimir etiqueta</div>
        <div className="px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={personalizar} onChange={(e) => setPersonalizar(e.target.checked)} className="size-4 accent-[var(--brand)]" />
            Personalizar o tamanho (cm)
          </label>
          {personalizar ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-text-muted">Largura (cm)</label>
                <input type="number" step="0.1" min={2} max={30} className={inputClass} value={lc} onChange={(e) => setLc(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-text-muted">Altura (cm)</label>
                <input type="number" step="0.1" min={2} max={30} className={inputClass} value={ac} onChange={(e) => setAc(e.target.value)} />
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-text-muted">Vai usar o tamanho padrão definido pela loja.</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={() => setOpen(false)} className={btnClass('outline')}>Cancelar</button>
          <button type="button" onClick={imprimir} className={btnClass('primary')}>
            <Printer className="size-4" /> Imprimir
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
