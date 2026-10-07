import type { StatusCompra as Status } from '@/app/(app)/compras/dados'

const S: Record<Status, { rotulo: string; ponto: string }> = {
  pendente: { rotulo: 'Pendente de produto', ponto: 'bg-warn' },
  parcial: { rotulo: 'Parcial', ponto: 'bg-warn' },
  lancada: { rotulo: 'Lançada', ponto: 'bg-ok' },
  cancelada: { rotulo: 'Estornada', ponto: 'bg-text-muted/50' },
}

export function StatusCompra({ status }: { status: Status }) {
  const s = S[status]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text">
      <span className={`size-2 shrink-0 rounded-full ${s.ponto}`} />{s.rotulo}
    </span>
  )
}
