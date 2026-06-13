const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-[var(--brand-strong)]',
  outline: 'border border-border bg-surface text-text hover:bg-surface-2',
  danger: 'bg-[var(--err)] text-white hover:opacity-90',
  ghost: 'text-text-muted hover:bg-surface-2 hover:text-text',
} as const

export type BtnVariant = keyof typeof VARIANTS

export function btnClass(variant: BtnVariant = 'primary'): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200 active:scale-[0.98] disabled:opacity-60 ${VARIANTS[variant]}`
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: { variant?: BtnVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`${btnClass(variant)} ${className}`}
      style={{ transitionTimingFunction: 'var(--ease)' }}
      {...props}
    />
  )
}
