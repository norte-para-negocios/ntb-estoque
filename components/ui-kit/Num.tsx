export function Num({
  value,
  frac = 0,
  className = '',
}: {
  value: number | null | undefined
  frac?: number
  className?: string
}) {
  const v = value ?? 0
  return (
    <span className={`num ${className}`}>
      {v.toLocaleString('pt-BR', { minimumFractionDigits: frac, maximumFractionDigits: frac })}
    </span>
  )
}
