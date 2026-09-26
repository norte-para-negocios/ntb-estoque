'use client'

import { useTransition } from 'react'
import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { reverterOP } from '@/lib/actions/ordem-producao'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { FUNDO_CLASSE } from '@/lib/status-cor'
import type { DetalheOP as DetalheOPData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = d.slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
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
      <div className="rounded-[var(--r-lg)] bg-surface-2 divide-y divide-border/60">
        <Linha label="OP"><span className="num">{dados.numOP}</span></Linha>
        <Linha label="Produto">{dados.produto} ({dados.unidade})</Linha>
        <Linha label="Qtd. planejada"><span className="num">{dados.qtdPlanejada ?? '-'}</span></Linha>
        <Linha label="Qtd. produzida"><span className="num">{dados.qtdProduzida ?? '-'}</span></Linha>
        <Linha label="Previsão"><span className="num">{fmtData(dados.dataPrevisao)}</span></Linha>
        <Linha label="Conclusão real"><span className="num">{fmtData(dados.dataConclusao)}</span></Linha>
        <Linha label="Status">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className={`size-2 shrink-0 rounded-full ${dados.concluida ? FUNDO_CLASSE.ok : FUNDO_CLASSE.neutro}`} />
            {dados.concluida ? 'Concluída' : 'Em andamento'}
          </span>
        </Linha>
      </div>
      {dados.ingredientes.length > 0 && (
        <div>
          <p className="mb-1.5 px-4 text-[13px] font-semibold text-text-muted">Ingredientes</p>
          <ul className="rounded-[var(--r-lg)] bg-surface-2 divide-y divide-border/60">
            {dados.ingredientes.map((i) => (
              <li key={i.cod} className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5 text-[15px]">
                <span className="min-w-0 text-text">{i.nome}</span>
                <span className="num shrink-0 text-text-muted">{i.qtd} {i.unidade}</span>
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
