import { statusInfo, FUNDO_CLASSE } from '@/lib/status-cor'

// Selo de status. Cor vem dos tokens semânticos (acompanha o dark mode); a bolinha
// herda a cor do texto via bg-current. Status "vivos" (em andamento) ganham um halo
// pulsante na bolinha (u-pulse-dot), estilo "live dot" do Linear; terminais ficam estáticos.
export function StatusPill({ status }: { status: string | null }) {
  const { label, token, vivo } = statusInfo(status)
  return (
    // Estilo Apple: ponto 8px na cor do status + texto neutro (sem bloco colorido).
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text">
      <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[token]}${vivo ? ' u-pulse-dot' : ''}`} />
      {label}
    </span>
  )
}
