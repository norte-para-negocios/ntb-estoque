'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

export function CopiarLinkRelatorio({ href }: { href: string }) {
  const [copiado, setCopiado] = useState(false)
  function copiar() {
    const url = new URL(href, window.location.origin).toString()
    navigator.clipboard.writeText(url)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }
  return (
    <button
      type="button"
      onClick={copiar}
      className={btnClass('outline')}
      title="Copiar link do relatório pra compartilhar"
    >
      {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copiado ? 'Copiado' : 'Copiar link'}
    </button>
  )
}
