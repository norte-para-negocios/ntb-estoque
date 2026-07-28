'use client'

import { ContagemInventario } from '@/components/inventario/ContagemInventario'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import type { DetalheInventario as DetalheInventarioData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string): string {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

export function DetalheInventario({ dados }: { dados: DetalheInventarioData }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Local</p>
        <p className="text-sm text-text">{dados.local}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
        <span className="num">{fmtData(dados.data)}</span>
        <StatusPill status={dados.status} />
        {dados.responsavel && <span>por {dados.responsavel}</span>}
      </div>
      <ContagemInventario
        inventarioId={dados.id}
        itensIniciais={dados.itens}
        finalizado={dados.finalizado}
        podeEditar={dados.podeEditar}
      />
    </div>
  )
}
