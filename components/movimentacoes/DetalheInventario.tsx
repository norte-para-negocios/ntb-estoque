'use client'

import { ContagemInventario } from '@/components/inventario/ContagemInventario'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import type { DetalheInventario as DetalheInventarioData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string): string {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

// Linha de lista agrupada (estilo Ajustes): rótulo à esquerda, valor à direita.
function Linha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5">
      <span className="shrink-0 text-[15px] text-text-muted">{label}</span>
      <span className="min-w-0 text-right text-[15px] text-text">{children}</span>
    </div>
  )
}

export function DetalheInventario({ dados }: { dados: DetalheInventarioData }) {
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--r-lg)] bg-surface-2 divide-y divide-border/60">
        <Linha label="Local">{dados.local}</Linha>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[13px] text-text-muted">
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
