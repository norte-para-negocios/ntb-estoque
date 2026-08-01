'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, RotateCcw, Trash2 } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { manifestarNF, reverterManifestacaoNF, excluirRecebimentoNF } from '@/lib/actions/nota-fiscal'

export function AcoesNF({
  notaId,
  concluida,
  cancelada,
  podeManifestar,
  podeReverter,
  podeExcluir,
}: {
  notaId: number
  concluida: boolean
  cancelada: boolean
  podeManifestar: boolean
  podeReverter: boolean
  podeExcluir: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function manifestar() {
    if (!window.confirm('Marcar esta nota como recebida/concluída no Omie?')) return
    startTransition(async () => {
      const res = await manifestarNF(notaId)
      if (res?.error) toast.error(res.error)
      else { toast.success('Nota marcada como concluída.'); router.refresh() }
    })
  }

  function reverter() {
    if (!window.confirm('Reverter a conclusão desta nota no Omie? Ela volta para Pendente.')) return
    startTransition(async () => {
      const res = await reverterManifestacaoNF(notaId)
      if (res?.error) toast.error(res.error)
      else { toast.success('Conclusão revertida.'); router.refresh() }
    })
  }

  function excluir() {
    if (!window.confirm('Excluir o recebimento desta nota no Omie? Isso é IRREVERSÍVEL e remove a nota do sistema.')) return
    startTransition(async () => {
      const res = await excluirRecebimentoNF(notaId)
      if (res?.error) toast.error(res.error)
      else {
        toast.success(res?.fantasma ? 'Nota removida (já não existia mais no Omie).' : 'Recebimento excluído.')
        router.push('/nota-fiscal')
      }
    })
  }

  if (!podeManifestar && !podeReverter && !podeExcluir) return null

  return (
    <div className="flex flex-wrap gap-2">
      {podeManifestar && !concluida && !cancelada && (
        <button type="button" disabled={pending} onClick={manifestar} className={btnClass('outline')}>
          <CheckCircle2 className="size-4" /> Manifestar (marcar recebida)
        </button>
      )}
      {podeReverter && concluida && (
        <button type="button" disabled={pending} onClick={reverter} className={btnClass('outline')}>
          <RotateCcw className="size-4" /> Reverter conclusão
        </button>
      )}
      {podeExcluir && (
        <button type="button" disabled={pending} onClick={excluir} className={btnClass('outline')}>
          <Trash2 className="size-4" /> Excluir recebimento
        </button>
      )}
    </div>
  )
}
