'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { manifestarNF } from '@/lib/actions/nota-fiscal'

/** Botão "Concluir nota" (loja com Omie), dentro do painel de entrada: só libera quando não falta nada. */
export function BarraConcluirNF({ notaId, concluida, cancelada, podeConcluir, pronto, resumo }: {
  notaId: number; concluida: boolean; cancelada: boolean; podeConcluir: boolean; pronto: boolean
  /** O que acontece ao concluir, em uma frase. */
  resumo?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  if (cancelada) return null
  if (concluida) return <p className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ok"><CheckCircle2 className="size-4" />Nota concluída no Omie</p>
  if (!podeConcluir) return <p className="text-[13px] text-text-muted">Você não tem permissão para concluir notas.</p>

  function concluir() {
    if (!window.confirm('Concluir o recebimento desta nota no Omie? Ela passa para Concluída.')) return
    start(async () => {
      const r = await manifestarNF(notaId)
      if (r?.error) toast.error(r.error)
      else { toast.success('Nota concluída.'); router.refresh() }
    })
  }

  return (
    <div className="space-y-2">
      <button type="button" className={`${btnClass('primary')} w-full justify-center py-3 text-[15px]`} disabled={pending || !pronto} onClick={concluir}>
        {pending ? <Spinner /> : <CheckCircle2 className="size-4" />}Concluir nota
      </button>
      <p className="text-[12.5px] text-text-muted">{pronto ? resumo : 'Resolva os itens marcados com ! para liberar.'}</p>
    </div>
  )
}
