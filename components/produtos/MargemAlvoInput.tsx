'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

export function MargemAlvoInput({
  valor,
  baseParams,
  naUrl = false,
}: {
  valor: number
  baseParams: string
  naUrl?: boolean
}) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Margem salva no perfil (localStorage): sem margem explicita na URL, reaplica
  // a ultima que o usuario escolheu. Pedido da reuniao 16/06 ("fica salvo").
  useEffect(() => {
    if (naUrl) return
    const salva = Number(localStorage.getItem('ntb_margem_alvo'))
    if (salva >= 1 && salva <= 99 && salva !== valor) {
      const sp = new URLSearchParams(baseParams)
      sp.set('margem', String(salva))
      router.replace(`/produto?${sp.toString()}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onChange(v: string) {
    const n = Number(v)
    if (!v || Number.isNaN(n) || n < 1 || n > 99) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      localStorage.setItem('ntb_margem_alvo', String(n))
      const sp = new URLSearchParams(baseParams)
      sp.set('margem', String(n))
      router.push(`/produto?${sp.toString()}`)
    }, 600)
  }

  return (
    <label className="flex items-center gap-2 whitespace-nowrap text-[13px] text-text-muted">
      <span>Margem alvo</span>
      <span className="flex h-9 items-center gap-1 rounded-[var(--r-md)] bg-surface-2 px-2.5 focus-within:ring-2 focus-within:ring-brand/40 max-sm:h-11">
        <input
          type="number"
          min={1}
          max={99}
          defaultValue={valor}
          onChange={(e) => onChange(e.target.value)}
          onWheel={(e) => e.currentTarget.blur()}
          aria-label="Margem alvo (%)"
          className="num w-9 border-0 bg-transparent text-center text-[15px] font-semibold text-text outline-none max-sm:text-base"
        />
        <span className="text-text-muted">%</span>
      </span>
    </label>
  )
}
