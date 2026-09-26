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
    // Estilo Apple: sem caixa tracejada — ícone grande esmaecido, título e dica.
    <div className="u-fade-in px-6 py-14 text-center">
      <Icon className="mx-auto mb-3 size-10 text-text-muted/50" strokeWidth={1.5} />
      <p className="text-[17px] font-semibold text-text">{title}</p>
      {hint && <p className="mt-1 text-[13px] text-text-muted">{hint}</p>}
    </div>
  )
}
