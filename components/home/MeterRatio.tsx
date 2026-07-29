export function MeterRatio({
  label,
  pct,
  limite,
}: {
  label: string
  pct: number | null
  limite: number
}) {
  if (pct == null) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
        <p className="mt-1 text-sm text-text-muted">Sem faturamento no período</p>
      </div>
    )
  }
  const acimaDoLimite = pct > limite
  const escala = Math.max(limite * 2, pct)
  const larguraPct = Math.min(100, (pct / escala) * 100)
  const larguraLimite = Math.min(100, (limite / escala) * 100)
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
        <span className={`num text-sm font-bold ${acimaDoLimite ? 'text-err' : 'text-ok'}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full u-motion ${acimaDoLimite ? 'bg-err' : 'bg-ok'}`}
          style={{ width: `${larguraPct}%` }}
        />
        <div className="absolute top-0 h-full w-px bg-text/40" style={{ left: `${larguraLimite}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-text-muted">Referência: até {limite}%</p>
    </div>
  )
}
