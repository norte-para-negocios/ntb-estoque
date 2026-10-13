'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays } from 'lucide-react'

const campo = 'rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none u-motion focus:ring-2 focus:ring-brand/40'

/** Escolhe a data do saldo (?data=YYYY-MM-DD). "Hoje" volta para o saldo atual do Omie. */
export function SeletorData({ basePath = '/estoque', min, max }: { basePath?: string; min?: string | null; max: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const atual = sp.get('data') ?? ''

  function ir(data: string) {
    const p = new URLSearchParams(sp.toString())
    p.delete('page')
    if (data) p.set('data', data)
    else p.delete('data')
    const qs = p.toString()
    router.push(qs ? `${basePath}?${qs}` : basePath)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
      <CalendarDays className="size-4" />
      <label htmlFor="saldo-data">Saldo em</label>
      <input id="saldo-data" type="date" value={atual} min={min ?? undefined} max={max} onChange={(e) => ir(e.target.value)} className={campo} />
      <button type="button" onClick={() => ir('')} disabled={!atual}
        className={`rounded-full px-3 py-1 font-medium u-card ${atual ? 'bg-surface text-text' : 'bg-text text-surface'}`}>Hoje</button>
    </div>
  )
}
