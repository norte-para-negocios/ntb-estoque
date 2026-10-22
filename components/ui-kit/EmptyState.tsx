import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  /** Ação do estado vazio (ex.: link para o cadastro que falta). */
  children?: ReactNode
}) {
  return (
    // Estilo Apple: sem caixa tracejada — ícone grande esmaecido, título e dica.
    <div className="u-fade-in px-6 py-14 text-center">
      <Icon className="mx-auto mb-3 size-10 text-text-muted/50" strokeWidth={1.5} />
      <p className="text-[17px] font-semibold text-text">{title}</p>
      {hint && <p className="mt-1 text-[13px] text-text-muted">{hint}</p>}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}
