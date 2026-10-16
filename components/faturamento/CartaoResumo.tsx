// Cartao de resumo do topo dos paineis (Faturamento, Notas Fiscais, Compras).
export function CartaoResumo({ titulo, valor, sub }: { titulo: string; valor: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="text-[13px] text-text-muted">{titulo}</div>
      <div className="num mt-1 truncate text-[18px] font-semibold leading-tight tracking-[-0.02em] text-text sm:text-[22px] sm:leading-none">{valor}</div>
      {sub && <div className="mt-1.5 truncate text-[12px] text-text-muted" title={sub}>{sub}</div>}
    </div>
  )
}
