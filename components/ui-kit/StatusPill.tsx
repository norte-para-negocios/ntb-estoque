const MAP: Record<string, { label: string; color: string }> = {
  Concluido: { label: 'Concluído', color: '#10b981' },
  Finalizado: { label: 'Finalizado', color: '#10b981' },
  Processando: { label: 'Processando', color: '#3b82f6' },
  'Processando no Omie': { label: 'Processando no Omie', color: '#3b82f6' },
  'Em contagem': { label: 'Em contagem', color: '#f59e0b' },
  Iniciado: { label: 'Iniciado', color: '#64748b' },
  'Sem CMC': { label: 'Sem CMC', color: '#f59e0b' },
  Erro: { label: 'Erro', color: '#ef4444' },
}

export function StatusPill({ status }: { status: string | null }) {
  const s = (status && MAP[status]) || { label: status ?? 'N/A', color: '#64748b' }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: s.color, background: `${s.color}1a` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  )
}
