'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const inputClass =
  'h-9 rounded-md border border-border bg-surface px-2 text-sm text-text outline-none transition-colors focus:border-brand'

// Soma dias a uma data YYYY-MM-DD (parsing local, sem fuso).
function addDias(iso: string, d: number): string {
  const [y, m, day] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day + d))
  return dt.toISOString().slice(0, 10)
}

export function ResumoFiltros({
  data,
  lojaSel,
  lojas,
  hoje,
}: {
  data: string
  lojaSel: number | null
  lojas: { id: number; nome: string }[]
  hoje: string
}) {
  const router = useRouter()

  function ir(novaData: string, novaLoja: number | null) {
    const p = new URLSearchParams()
    p.set('data', novaData)
    if (novaLoja != null) p.set('loja', String(novaLoja))
    router.push(`/resumo?${p.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Navegacao de data: dia anterior / input / proximo (limitado a hoje) */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Dia anterior"
          onClick={() => ir(addDias(data, -1), lojaSel)}
          className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-text-muted u-motion hover:bg-surface-2 hover:text-text"
        >
          <ChevronLeft className="size-4" />
        </button>
        <input
          type="date"
          value={data}
          max={hoje}
          onChange={(e) => e.target.value && ir(e.target.value, lojaSel)}
          className={`${inputClass} num w-40 text-center`}
        />
        <button
          type="button"
          aria-label="Próximo dia"
          disabled={data >= hoje}
          onClick={() => ir(addDias(data, 1), lojaSel)}
          className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-text-muted u-motion hover:bg-surface-2 hover:text-text disabled:opacity-40"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Seletor de loja (so quando ha mais de uma no escopo) */}
      {lojas.length > 1 && (
        <select
          value={lojaSel ?? ''}
          onChange={(e) => ir(data, e.target.value ? Number(e.target.value) : null)}
          className={`${inputClass} max-w-[14rem]`}
        >
          <option value="">Todas as lojas</option>
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>{l.nome}</option>
          ))}
        </select>
      )}

      {data !== hoje && (
        <button
          type="button"
          onClick={() => ir(hoje, lojaSel)}
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm font-medium text-brand u-motion hover:bg-surface-2"
        >
          Hoje
        </button>
      )}
    </div>
  )
}
