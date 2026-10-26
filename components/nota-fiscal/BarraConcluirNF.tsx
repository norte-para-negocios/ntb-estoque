'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { manifestarNF } from '@/lib/actions/nota-fiscal'

/** Barra fixa embaixo (loja com Omie): diz o que falta e só libera "Concluir nota" quando estiver tudo certo. */
export function BarraConcluirNF({ notaId, concluida, cancelada, podeConcluir, faltas }: {
  notaId: number; concluida: boolean; cancelada: boolean; podeConcluir: boolean; faltas: string[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  if (cancelada || !podeConcluir) return null

  function concluir() {
    if (!window.confirm('Concluir o recebimento desta nota no Omie? Ela passa para Concluída.')) return
    start(async () => {
      const r = await manifestarNF(notaId)
      if (r?.error) toast.error(r.error)
      else { toast.success('Nota concluída.'); router.refresh() }
    })
  }

  const pronto = faltas.length === 0
  return (
    <div className="sticky bottom-0 z-10 -mx-1 rounded-[var(--r-lg)] bg-surface px-4 py-3 shadow-[0_-4px_18px_rgb(0_0_0/0.10)]">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          {concluida
            ? <p className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ok"><CheckCircle2 className="size-4" />Nota concluída</p>
            : pronto
              ? <p className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ok"><CheckCircle2 className="size-4" />Tudo certo, pode concluir</p>
              : <><p className="text-[14px] font-semibold text-text">Falta para concluir</p>
                  <p className="inline-flex items-start gap-1.5 text-[13px] text-warn"><CircleAlert className="mt-0.5 size-4 shrink-0" />{faltas.join(' · ')}</p></>}
        </div>
        {!concluida && (
          <button type="button" className={btnClass('primary')} disabled={pending || !pronto} onClick={concluir}>
            {pending ? <Spinner /> : <CheckCircle2 className="size-4" />}Concluir nota
          </button>
        )}
      </div>
    </div>
  )
}
