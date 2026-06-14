'use client'

import { useRouter } from 'next/navigation'
import { useRef } from 'react'

export function MargemAlvoInput({
  valor,
  baseParams,
}: {
  valor: number
  baseParams: string
}) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onChange(v: string) {
    const n = Number(v)
    if (!v || Number.isNaN(n) || n < 1 || n > 99) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const sp = new URLSearchParams(baseParams)
      sp.set('margem', String(n))
      router.push(`/produto?${sp.toString()}`)
    }, 600)
  }

  return (
    <div className="flex items-center gap-2 text-[12px] text-text-muted">
      <span className="uppercase tracking-wider">Margem alvo</span>
      <div className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1">
        <input
          type="number"
          min={1}
          max={99}
          defaultValue={valor}
          onChange={(e) => onChange(e.target.value)}
          className="num w-10 bg-transparent text-center text-sm font-medium text-text outline-none"
        />
        <span className="text-text-muted">%</span>
      </div>
    </div>
  )
}
