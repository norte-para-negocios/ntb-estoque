import type { Grafico } from '@/lib/resumo-dia'

function fmtVal(v: number, unidade: 'num' | 'reais'): string {
  return unidade === 'reais'
    ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : v.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
}

// Gráfico de barras horizontais (CSS puro). Mostra os principais itens do dia.
export function ResumoGrafico({ grafico }: { grafico: Grafico }) {
  const itens = grafico.itens
  if (!itens.length) return null
  const max = Math.max(...itens.map((i) => i.valor), 1)

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="eyebrow mb-4">{grafico.titulo}</div>
      <div className="space-y-3">
        {itens.map((it, i) => (
          <div key={i} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 sm:grid-cols-[11rem_1fr_auto]">
            <span className="truncate text-[13px] text-text" title={it.label}>{it.label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-brand u-motion"
                style={{ width: `${Math.max(3, (it.valor / max) * 100)}%` }}
              />
            </div>
            <span className="num min-w-[4rem] text-right text-[13px] font-semibold tabular-nums text-text">
              {fmtVal(it.valor, grafico.unidade)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
