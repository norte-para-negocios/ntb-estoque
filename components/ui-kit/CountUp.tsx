'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Count-up sutil para números de destaque (A7). O número "conta" de um valor
 * inicial até o final uma única vez ao montar, ~700ms, ease-out.
 *
 * Tom Linear/Stripe: discreto, rápido, sem repetir. Anima só o texto (sem
 * layout/transform), então é barato. Formata em pt-BR igual ao <Num> para
 * manter a tipografia tabular consistente.
 *
 * Acessibilidade: em prefers-reduced-motion mostra o valor final direto, sem
 * contar. SSR-safe: renderiza o valor final no servidor (evita "0" no HTML
 * inicial e flash); a contagem só começa no cliente após a montagem.
 */
function fmt(v: number, frac: number) {
  return v.toLocaleString('pt-BR', {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  })
}

// ease-out cubic: desacelera no fim, batendo com --ease-out do sistema.
function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

export function CountUp({
  value,
  frac = 0,
  duration = 700,
  /** Fração do valor de onde a contagem parte (0 = de zero). 0.0 por padrão. */
  from = 0,
  className = '',
}: {
  value: number | null | undefined
  frac?: number
  duration?: number
  from?: number
  className?: string
}) {
  const target = value ?? 0
  // Estado inicial = alvo (SSR e primeiro paint mostram o número certo).
  const [display, setDisplay] = useState(target)
  const startedRef = useRef(false)

  useEffect(() => {
    // Só anima uma vez, no mount. Mudanças posteriores de `value` saltam direto.
    if (startedRef.current) {
      setDisplay(target)
      return
    }
    startedRef.current = true

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced || target === 0 || duration <= 0) {
      setDisplay(target)
      return
    }

    const start = Math.round(target * Math.min(Math.max(from, 0), 1))
    setDisplay(start)

    let raf = 0
    let t0 = 0
    const tick = (now: number) => {
      if (!t0) t0 = now
      const p = Math.min((now - t0) / duration, 1)
      const v = start + (target - start) * easeOut(p)
      setDisplay(v)
      if (p < 1) raf = requestAnimationFrame(tick)
      else setDisplay(target)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // Intencional: roda só no mount. `value` posterior cai no early-return acima.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Arredonda na exibição: frac=0 mostra inteiros enquanto conta.
  const shown = frac === 0 ? Math.round(display) : display
  return (
    <span className={`num ${className}`} suppressHydrationWarning>
      {fmt(shown, frac)}
    </span>
  )
}
