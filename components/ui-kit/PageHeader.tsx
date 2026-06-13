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
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Icon className="size-[18px]" strokeWidth={2} />
          </span>
        )}
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-text">{title}</h1>
          {description && <p className="text-[13px] text-text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
