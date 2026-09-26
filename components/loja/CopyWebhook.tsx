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
        className="num w-full min-w-0 rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none"
      />
      <button type="button" onClick={copiar} className={`${btnClass('outline')} shrink-0`}>
        {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}
