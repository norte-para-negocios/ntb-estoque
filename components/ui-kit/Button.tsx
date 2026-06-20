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

// Botão de AÇÃO DE LINHA: no celular vira só ícone (o rótulo se esconde via
// <RotuloAcao>), quadrado size-8 sem padding; no desktop mostra o texto com o
// padding normal. Não herda o px-3 do btnClass (evita conflito de padding do
// Tailwind). Evita estouro horizontal nas listas de operação. Use sempre junto
// de <RotuloAcao> no rótulo.
export function btnLinhaClass(variant: BtnVariant = 'outline'): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium u-motion u-press disabled:opacity-60 disabled:active:scale-100 size-8 shrink-0 2xl:size-auto 2xl:px-3 2xl:py-1.5 ${VARIANTS[variant]}`
}

// Rótulo de ação que some em telas estreitas (só ícone) e aparece quando há
// folga de sobra (2xl). Mantém a linha de ações compacta no celular e no
// desktop apertado, evitando estouro/corte; com texto só onde cabe numa linha.
export function RotuloAcao({ children }: { children: React.ReactNode }) {
  return <span className="hidden 2xl:inline">{children}</span>
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: { variant?: BtnVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${btnClass(variant)} ${className}`} {...props} />
}
