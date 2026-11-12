'use client'

import { useEffect, useState } from 'react'

// Pacioli oficial (public/pacioli/ver.html) acenando na vitrine. Menos movimento: pose parada (&freeze).
// O endereço só é montado no navegador para saber a preferência de movimento antes de carregar.
export function MascoteVitrine({ fundo }: { fundo: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const montar = () => {
      const q = new URLSearchParams({ a: '44-acenando', tema: 'claro', bg: fundo.replace('#', ''), veste: 'chef' })
      q.set('semico', '')
      if (mq.matches) { q.set('freeze', ''); q.set('t', '2') }
      setSrc(`/pacioli/ver.html?${q.toString()}`)
    }
    montar()
    mq.addEventListener('change', montar)
    return () => mq.removeEventListener('change', montar)
  }, [fundo])
  return (
    <div className="mx-auto mt-12 aspect-square w-[min(240px,62vw)] overflow-hidden rounded-[40px] shadow-[0_40px_80px_-40px_rgba(10,10,40,0.6)]" style={{ background: fundo }}>
      {src && (
        <iframe
          key={src}
          src={src}
          title="Pacioli acenando"
          aria-hidden="true"
          tabIndex={-1}
          sandbox="allow-scripts allow-same-origin"
          className="pointer-events-none size-full border-0"
        />
      )}
    </div>
  )
}
