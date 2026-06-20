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
    <div className="mb-3 flex flex-col gap-2.5 sm:mb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand sm:size-9">
            <Icon className="size-[18px]" strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight tracking-[-0.01em] text-text sm:text-xl">{title}</h1>
          {description && <p className="mt-0.5 hidden text-[13px] text-text-muted sm:block">{description}</p>}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>
      )}
    </div>
  )
}
