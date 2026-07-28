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

type Resultado =
  | { chave: string; status: 'erro'; mensagem: string }
  | { chave: string; status: 'op'; dados: DetalheOP }
  | { chave: string; status: 'transferencia'; dados: DetalheTransferencia }
  | { chave: string; status: 'nota_fiscal'; dados: DetalheNotaFiscal }
  | { chave: string; status: 'inventario'; dados: DetalheInventario }

function chaveDe(origem: OrigemMovimento): string {
  return `${origem.tipo}:${origem.id}`
}

export function DetalheMovimentoSheet({
  origem,
  onOpenChange,
}: {
  origem: OrigemMovimento | null
  onOpenChange: (o: OrigemMovimento | null) => void
}) {
  const [resultado, setResultado] = useState<Resultado | null>(null)

  useEffect(() => {
    if (!origem) return
    let cancelado = false
    const chave = chaveDe(origem)
    ;(async () => {
      if (origem.tipo === 'op') {
        const r = await buscarDetalheOP(origem.id)
        if (!cancelado) setResultado('error' in r ? { chave, status: 'erro', mensagem: r.error } : { chave, status: 'op', dados: r })
      } else if (origem.tipo === 'transferencia') {
        const r = await buscarDetalheTransferencia(origem.id)
        if (!cancelado) setResultado('error' in r ? { chave, status: 'erro', mensagem: r.error } : { chave, status: 'transferencia', dados: r })
      } else if (origem.tipo === 'nota_fiscal') {
        const r = await buscarDetalheNotaFiscal(String(origem.id))
        if (!cancelado) setResultado('error' in r ? { chave, status: 'erro', mensagem: r.error } : { chave, status: 'nota_fiscal', dados: r })
      } else {
        const r = await buscarDetalheInventario(origem.id)
        if (!cancelado) setResultado('error' in r ? { chave, status: 'erro', mensagem: r.error } : { chave, status: 'inventario', dados: r })
      }
    })()
    return () => { cancelado = true }
  }, [origem])

  const chaveAtual = origem ? chaveDe(origem) : null
  const carregando = chaveAtual !== null && resultado?.chave !== chaveAtual
  const pronto = resultado?.chave === chaveAtual ? resultado : null

  return (
    <Sheet open={origem !== null} onOpenChange={(open) => !open && onOpenChange(null)}>
      <SheetContent side="right" className="w-[92vw] overflow-y-auto bg-surface sm:max-w-none sm:w-[520px]" showCloseButton>
        <SheetHeader>
          <SheetTitle>{origem ? TITULOS[origem.tipo] : ''}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          {carregando && (
            <div className="flex items-center justify-center py-12"><Spinner /></div>
          )}
          {pronto?.status === 'erro' && (
            <p className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[13px] text-text-muted">{pronto.mensagem}</p>
          )}
          {pronto?.status === 'op' && (
            <DetalheOPView dados={pronto.dados} onRevertido={() => onOpenChange(null)} />
          )}
          {pronto?.status === 'transferencia' && <DetalheTransferenciaView dados={pronto.dados} />}
          {pronto?.status === 'nota_fiscal' && <DetalheNotaFiscalView dados={pronto.dados} />}
          {pronto?.status === 'inventario' && <DetalheInventarioView dados={pronto.dados} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}
