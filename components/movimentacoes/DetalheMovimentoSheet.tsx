'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui-kit/Spinner'
import { DetalheOP as DetalheOPView } from '@/components/movimentacoes/DetalheOP'
import { DetalheTransferencia as DetalheTransferenciaView } from '@/components/movimentacoes/DetalheTransferencia'
import { DetalheNotaFiscal as DetalheNotaFiscalView } from '@/components/movimentacoes/DetalheNotaFiscal'
import { DetalheInventario as DetalheInventarioView } from '@/components/movimentacoes/DetalheInventario'
import {
  buscarDetalheOP,
  buscarDetalheTransferencia,
  buscarDetalheNotaFiscal,
  buscarDetalheInventario,
  type DetalheOP,
  type DetalheTransferencia,
  type DetalheNotaFiscal,
  type DetalheInventario,
} from '@/lib/actions/detalhe-movimento'

export type OrigemMovimento =
  | { tipo: 'op'; id: number }
  | { tipo: 'transferencia'; id: number }
  | { tipo: 'nota_fiscal'; id: number }
  | { tipo: 'inventario'; id: number }

const TITULOS: Record<OrigemMovimento['tipo'], string> = {
  op: 'Ordem de Produção',
  transferencia: 'Transferência',
  nota_fiscal: 'Nota Fiscal',
  inventario: 'Inventário',
}

type Estado =
  | { status: 'carregando' }
  | { status: 'erro'; mensagem: string }
  | { status: 'op'; dados: DetalheOP }
  | { status: 'transferencia'; dados: DetalheTransferencia }
  | { status: 'nota_fiscal'; dados: DetalheNotaFiscal }
  | { status: 'inventario'; dados: DetalheInventario }

export function DetalheMovimentoSheet({
  origem,
  onOpenChange,
}: {
  origem: OrigemMovimento | null
  onOpenChange: (o: OrigemMovimento | null) => void
}) {
  const [estado, setEstado] = useState<Estado>({ status: 'carregando' })

  useEffect(() => {
    if (!origem) return
    setEstado({ status: 'carregando' })
    ;(async () => {
      if (origem.tipo === 'op') {
        const r = await buscarDetalheOP(origem.id)
        setEstado('error' in r ? { status: 'erro', mensagem: r.error } : { status: 'op', dados: r })
      } else if (origem.tipo === 'transferencia') {
        const r = await buscarDetalheTransferencia(origem.id)
        setEstado('error' in r ? { status: 'erro', mensagem: r.error } : { status: 'transferencia', dados: r })
      } else if (origem.tipo === 'nota_fiscal') {
        const r = await buscarDetalheNotaFiscal(String(origem.id))
        setEstado('error' in r ? { status: 'erro', mensagem: r.error } : { status: 'nota_fiscal', dados: r })
      } else {
        const r = await buscarDetalheInventario(origem.id)
        setEstado('error' in r ? { status: 'erro', mensagem: r.error } : { status: 'inventario', dados: r })
      }
    })()
  }, [origem])

  return (
    <Sheet open={origem !== null} onOpenChange={(open) => !open && onOpenChange(null)}>
      <SheetContent side="right" className="w-[92vw] overflow-y-auto bg-surface sm:max-w-none sm:w-[520px]" showCloseButton>
        <SheetHeader>
          <SheetTitle>{origem ? TITULOS[origem.tipo] : ''}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          {estado.status === 'carregando' && (
            <div className="flex items-center justify-center py-12"><Spinner /></div>
          )}
          {estado.status === 'erro' && (
            <p className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[13px] text-text-muted">{estado.mensagem}</p>
          )}
          {estado.status === 'op' && (
            <DetalheOPView dados={estado.dados} onRevertido={() => onOpenChange(null)} />
          )}
          {estado.status === 'transferencia' && <DetalheTransferenciaView dados={estado.dados} />}
          {estado.status === 'nota_fiscal' && <DetalheNotaFiscalView dados={estado.dados} />}
          {estado.status === 'inventario' && <DetalheInventarioView dados={estado.dados} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}
