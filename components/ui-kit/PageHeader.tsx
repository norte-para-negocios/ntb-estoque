import Link from 'next/link'
import { ArrowLeft, type LucideIcon } from 'lucide-react'

export function PageHeader({
  title,
  // icon: aceito por compatibilidade, não é mais desenhado (estilo Apple).
  icon: _icon,
  description,
  actions,
  voltarHref,
}: {
  title: string
  icon?: LucideIcon
  description?: string
  actions?: React.ReactNode
  /** Pedido reuniao 09/07: botao Voltar faltava em varios relatorios. Opcional -- so
   *  aparece quando informado (ex.: voltarHref="/relatorios"). */
  voltarHref?: string
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {voltarHref && (
          <Link
            href={voltarHref}
            aria-label="Voltar"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted u-motion u-press hover:bg-[var(--border)] hover:text-text"
          >
            <ArrowLeft className="size-[18px]" strokeWidth={2} />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-text sm:text-[30px]">{title}</h1>
          {description && <p className="mt-1 hidden text-[15px] text-text-muted sm:block">{description}</p>}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>
      )}
    </div>
  )
}
