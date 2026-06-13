import type { LucideIcon } from 'lucide-react'

export function PageHeader({
  title,
  icon: Icon,
  description,
  actions,
}: {
  title: string
  icon?: LucideIcon
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Icon className="size-[18px]" strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-text">{title}</h1>
          {description && <p className="text-[13px] text-text-muted">{description}</p>}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>
      )}
    </div>
  )
}
