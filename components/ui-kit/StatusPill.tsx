import { statusInfo, SELO_CLASSE } from '@/lib/status-cor'

// Selo de status. Cor vem dos tokens semânticos (acompanha o dark mode); a bolinha
// herda a cor do texto via bg-current.
export function StatusPill({ status }: { status: string | null }) {
  const { label, token } = statusInfo(status)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${SELO_CLASSE[token]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}
