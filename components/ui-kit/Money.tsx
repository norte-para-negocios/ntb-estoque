export function Money({
  value,
  className = '',
}: {
  value: number | null | undefined
  className?: string
}) {
  const v = value ?? 0
  return (
    <span className={`num ${className}`}>
      {v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
    </span>
  )
}
