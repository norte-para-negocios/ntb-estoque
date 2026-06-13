'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

export function CopyWebhook({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false)

  function copiar() {
    navigator.clipboard.writeText(url)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="flex gap-2">
      <input
        value={url}
        readOnly
        className="num w-full rounded-md border border-border bg-surface-2/40 px-3 py-1.5 text-sm text-text outline-none"
      />
      <button type="button" onClick={copiar} className={`${btnClass('outline')} shrink-0`}>
        {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}
