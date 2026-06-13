'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import {
  duplicarTransferencia,
  excluirTransferencia,
  forceSyncTransferencia,
} from '@/lib/actions/transferencia'

export function AcoesTransferencia({
  transferenciaId,
  temErro,
  podeExcluir,
}: {
  transferenciaId: number
  temErro: boolean
  podeExcluir: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function duplicar() {
    startTransition(async () => {
      const res = await duplicarTransferencia(transferenciaId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else if (res?.id) {
        toast.success('Transferência duplicada')
        router.push(`/transferencia/${res.id}/contagem`)
      }
    })
  }

  function reprocessar() {
    startTransition(async () => {
      const res = await forceSyncTransferencia(transferenciaId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Itens com erro reprocessados')
        router.refresh()
      }
    })
  }

  function excluir() {
    if (
      !window.confirm(
        'Excluir esta transferência? Os ajustes já lançados no Omie serão removidos.'
      )
    )
      return
    startTransition(async () => {
      const res = await excluirTransferencia(transferenciaId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Transferência excluída')
        router.refresh()
      }
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={duplicar}
        disabled={pending}
        className={btnClass('outline')}
        aria-label="Duplicar"
        title="Duplicar"
      >
        <Copy className="size-4" /> Duplicar
      </button>
      {temErro && (
        <button
          onClick={reprocessar}
          disabled={pending}
          className={btnClass('outline')}
          aria-label="Reprocessar"
          title="Reprocessar itens com erro"
        >
          <RefreshCw className="size-4" /> Reprocessar
        </button>
      )}
      {podeExcluir && (
        <button
          onClick={excluir}
          disabled={pending}
          className={btnClass('danger')}
          aria-label="Excluir"
          title="Excluir"
        >
          <Trash2 className="size-4" /> Excluir
        </button>
      )}
    </span>
  )
}
