import Link from 'next/link'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import { Num } from './Num'

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
    <div className="group relative overflow-hidden rounded-lg border border-border bg-surface p-4 u-card">
      <div
        className="absolute inset-x-0 top-0 h-[2px] opacity-60 u-motion group-hover:opacity-100"
        style={{ background: accent }}
      />
      <div className="flex items-center justify-between">
        <span
          className="flex size-8 items-center justify-center rounded-md"
          style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)` }}
        >
          <Icon className="size-4" style={{ color: accent }} strokeWidth={2} />
        </span>
        {href && (
          <ArrowUpRight className="size-4 text-text-muted/30 u-motion group-hover:translate-x-px group-hover:-translate-y-px group-hover:text-text-muted" />
        )}
      </div>
      <div className="mt-3 text-[1.7rem] font-semibold leading-none text-text">
        <Num value={value} />
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-text">{label}</div>
      {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
