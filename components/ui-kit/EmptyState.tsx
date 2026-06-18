import type { LucideIcon } from 'lucide-react'

export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon
  title: string
  hint?: string
}) {
  return (
    <div className="u-fade-in rounded-lg border border-dashed border-border bg-surface px-6 py-14 text-center">
      <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-surface-2 text-text-muted">
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-sm font-medium text-text">{title}</p>
      {hint && <p className="mt-0.5 text-[13px] text-text-muted">{hint}</p>}
    </div>
  )
}
