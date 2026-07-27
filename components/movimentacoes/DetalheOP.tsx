'use client'

import { useTransition } from 'react'
import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { reverterOP } from '@/lib/actions/ordem-producao'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import type { DetalheOP as DetalheOPData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = d.slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
}

export function DetalheOP({ dados, onRevertido }: { dados: DetalheOPData; onRevertido: () => void }) {
  const [pending, startTransition] = useTransition()

  function reverter() {
    if (!window.confirm('Reverter esta OP? A produção será estornada no Omie.')) return
    startTransition(async () => {
      const res = await reverterOP(dados.id)
      if (res && 'error' in res) {
        toast.error('Erro ao reverter', { description: res.error })
      } else {
        toast.success('OP revertida')
        onRevertido()
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">OP</p>
        <p className="text-sm text-text">{dados.numOP}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Produto</p>
        <p className="text-sm text-text">{dados.produto} ({dados.unidade})</p>
      </div>
      <div className="flex gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Qtd. planejada</p>
          <p className="num text-sm text-text">{dados.qtdPlanejada ?? '-'}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Qtd. produzida</p>
          <p className="num text-sm text-text">{dados.qtdProduzida ?? '-'}</p>
        </div>
      </div>
      <div className="flex gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Previsão</p>
          <p className="text-sm text-text">{fmtData(dados.dataPrevisao)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Conclusão real</p>
          <p className="text-sm text-text">{fmtData(dados.dataConclusao)}</p>
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Status</p>
        <p className={`text-sm font-medium ${dados.concluida ? 'text-ok' : 'text-text-muted'}`}>
          {dados.concluida ? 'Concluída' : 'Em andamento'}
        </p>
      </div>
      {dados.ingredientes.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Ingredientes</p>
          <ul className="space-y-1 rounded-md border border-border bg-surface-2 p-2.5">
            {dados.ingredientes.map((i) => (
              <li key={i.cod} className="flex items-center justify-between text-[13px]">
                <span className="text-text">{i.nome}</span>
                <span className="num text-text-muted">{i.qtd} {i.unidade}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dados.concluida && dados.podeReverter && (
        <button onClick={reverter} disabled={pending} className={`${btnClass('outline')} w-full`}>
          {pending ? <Spinner /> : <Undo2 className="size-4" />}
          {pending ? 'Revertendo...' : 'Reverter'}
        </button>
      )}
    </div>
  )
}
