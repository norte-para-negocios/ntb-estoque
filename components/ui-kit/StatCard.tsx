import Link from 'next/link'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import { CountUp } from './CountUp'

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  accent = 'var(--brand)',
}: {
  label: string
  value: number
  hint?: string
  icon: LucideIcon
  href?: string
  accent?: string
}) {
  const inner = (
    <div className="group relative overflow-hidden rounded-[var(--r-lg)] bg-surface p-4 u-card">
      <div className="flex items-center justify-between">
        {/* Estilo Apple: sem faixa colorida; `accent` fica aceito e ignorado. */}
        <Icon className="size-[18px] text-text-muted" strokeWidth={1.75} data-accent={accent} />
        {href && (
          <ArrowUpRight className="size-4 text-text-muted/30 u-motion group-hover:translate-x-px group-hover:-translate-y-px group-hover:text-text-muted" />
        )}
      </div>
      <div className="mt-3 text-[28px] font-semibold leading-none tracking-[-0.02em] text-text num">
        <CountUp value={value} duration={600} />
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-text">{label}</div>
      {hint && <div className="text-[12px] text-text-muted">{hint}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
