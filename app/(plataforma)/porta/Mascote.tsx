'use client'

import { useEffect, useState } from 'react'

// Pacioli oficial (public/pacioli/ver.html). Com menos movimento pedido pelo sistema: pose parada (&freeze).
export function Mascote({ acao }: { acao: '12-falando' | '44-acenando' }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const montar = () => {
      const q = new URLSearchParams({ a: acao, tema: 'claro', bg: 'ffffff', veste: 'chef' })
      q.set('semico', '')
      if (mq.matches) { q.set('freeze', ''); q.set('t', '2') }
      setSrc(`/pacioli/ver.html?${q.toString()}`)
    }
    montar()
    mq.addEventListener('change', montar)
    return () => mq.removeEventListener('change', montar)
  }, [acao])
  return (
    <div className="pn-mascote">
      {src && <iframe key={src} src={src} title="Pacioli" aria-hidden="true" tabIndex={-1} sandbox="allow-scripts allow-same-origin" />}
    </div>
  )
}
