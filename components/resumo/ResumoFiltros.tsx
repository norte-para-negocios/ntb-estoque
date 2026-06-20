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
  cat,
}: {
  data: string
  lojaSel: number | null
  lojas: { id: number; nome: string }[]
  hoje: string
  cat: string
}) {
  const router = useRouter()
  // Selecao atual como parametro de URL: 'todas' ou o id da loja.
  const lojaParam = lojaSel != null ? String(lojaSel) : 'todas'

  function ir(novaData: string, novaLojaParam: string) {
    const p = new URLSearchParams({ data: novaData, loja: novaLojaParam, cat })
    router.push(`/resumo?${p.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Navegacao de data: dia anterior / input / proximo (limitado a hoje) */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Dia anterior"
          onClick={() => ir(addDias(data, -1), lojaParam)}
          className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-text-muted u-motion hover:bg-surface-2 hover:text-text"
        >
          <ChevronLeft className="size-4" />
        </button>
        <input
          type="date"
          value={data}
          max={hoje}
          onChange={(e) => e.target.value && ir(e.target.value, lojaParam)}
          className={`${inputClass} num w-40 text-center`}
        />
        <button
          type="button"
          aria-label="Próximo dia"
          disabled={data >= hoje}
          onClick={() => ir(addDias(data, 1), lojaParam)}
          className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-text-muted u-motion hover:bg-surface-2 hover:text-text disabled:opacity-40"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Seletor de loja (so quando ha mais de uma no escopo) */}
      {lojas.length > 1 && (
        <select
          value={lojaParam}
          onChange={(e) => ir(data, e.target.value)}
          className={`${inputClass} max-w-[14rem]`}
        >
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>{l.nome}</option>
          ))}
          <option value="todas">Todas as lojas</option>
        </select>
      )}

      {data !== hoje && (
        <button
          type="button"
          onClick={() => ir(hoje, lojaParam)}
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm font-medium text-brand u-motion hover:bg-surface-2"
        >
          Hoje
        </button>
      )}
    </div>
  )
}
