'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { MoreHorizontal, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'

/**
 * Menu "Mais" do topo da nota (27/10/2026): XML, DANFE, copiar a chave e as ações que desfazem (reverter, excluir).
 * <details> nativo; fecha ao clicar fora ou com Esc.
 */
export function MenuNota({ chave, children }: { chave: string | null; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && ref.current) ref.current.open = false }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [])

  async function copiar() {
    if (!chave) return
    try { await navigator.clipboard.writeText(chave); toast.success('Chave de acesso copiada') }
    catch { toast.error('Não deu para copiar', { description: chave }) }
  }

  return (
    <details ref={ref} className="relative">
      <summary className={`${btnClass('outline')} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        <MoreHorizontal className="size-4" />Mais
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 flex w-64 flex-col gap-1 rounded-[var(--r-lg)] bg-surface p-2 shadow-[0_12px_32px_rgb(0_0_0/0.16)] [&_a]:w-full [&_a]:justify-start [&_button]:w-full [&_button]:justify-start [&>div]:flex-col [&>div]:gap-1 [&_a]:bg-transparent [&_button]:bg-transparent [&_a:hover]:bg-surface-2 [&_button:hover]:bg-surface-2">
        {children}
        {chave && (
          <button type="button" className={btnClass('ghost')} onClick={copiar}><Copy className="size-4" />Copiar chave de acesso</button>
        )}
      </div>
    </details>
  )
}
