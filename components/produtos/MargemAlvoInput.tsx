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
    <div className="flex items-center gap-2 text-[12px] text-text-muted">
      <span className="uppercase tracking-wider">Margem alvo</span>
      <div className="flex h-11 items-center gap-1 rounded-md border border-border bg-surface px-2 lg:h-8">
        <input
          type="number"
          min={1}
          max={99}
          defaultValue={valor}
          onChange={(e) => onChange(e.target.value)}
          onWheel={(e) => e.currentTarget.blur()}
          className="num w-10 bg-transparent text-center text-sm font-medium text-text outline-none"
        />
        <span className="text-text-muted">%</span>
      </div>
    </div>
  )
}
