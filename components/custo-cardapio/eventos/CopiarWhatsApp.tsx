'use client'

import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'

export function CopiarWhatsApp({ texto }: { texto: string }) {
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success('Copiado. É só colar no WhatsApp.')
    } catch {
      toast.error('Não deu para copiar. Tente pelo PDF.')
    }
  }
  return <button type="button" onClick={copiar} className={btnClass('outline')}><Copy className="size-4" /> Copiar para WhatsApp</button>
}
