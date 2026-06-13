'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyWebhook({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false)

  function copiar() {
    navigator.clipboard.writeText(url)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="flex gap-2">
      <input value={url} readOnly className="ntb-input font-mono" />
      <button type="button" onClick={copiar} className="ntb-btn-outline shrink-0">
        {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}
