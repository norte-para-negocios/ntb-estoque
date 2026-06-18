const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-[var(--brand-strong)]',
  outline: 'border border-border bg-surface text-text hover:bg-surface-2',
  danger: 'bg-err text-white hover:opacity-90',
  ghost: 'text-text-muted hover:bg-surface-2 hover:text-text',
} as const

export type BtnVariant = keyof typeof VARIANTS

export function btnClass(variant: BtnVariant = 'primary'): string {
  // u-motion: ritmo padrão do sistema (cor/sombra/transform, var(--dur) + ease-out).
  // u-press: press sutil (scale var(--press) = 0.98) com timing rápido.
  return `inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium u-motion u-press disabled:opacity-60 disabled:active:scale-100 ${VARIANTS[variant]}`
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: { variant?: BtnVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${btnClass(variant)} ${className}`} {...props} />
}
