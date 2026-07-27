'use client'

import { ContagemTransferencia } from '@/components/transferencia/ContagemTransferencia'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import type { DetalheTransferencia as DetalheTransferenciaData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string): string {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

export function DetalheTransferencia({ dados }: { dados: DetalheTransferenciaData }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-text-muted">{dados.origem}</span>
        <span className="text-text-muted">→</span>
        <span className="rounded bg-ok/15 px-1.5 py-0.5 font-medium text-ok">{dados.destino}</span>
        <StatusPill status={dados.status} />
      </div>
      <p className="text-[13px] text-text-muted">
        {fmtData(dados.data)}{dados.responsavel && ` · por ${dados.responsavel}`}
      </p>
      <ContagemTransferencia
        transferenciaId={dados.id}
        itensIniciais={dados.itens}
        finalizado={dados.finalizado}
        podeEditar={dados.podeEditar}
      />
    </div>
  )
}
