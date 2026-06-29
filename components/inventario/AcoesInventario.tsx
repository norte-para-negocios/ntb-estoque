'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { btnLinhaClass } from '@/components/ui-kit/Button'
import {
  duplicarInventario,
  excluirInventario,
  forceSyncInventario,
} from '@/lib/actions/inventario'

export function AcoesInventario({
  inventarioId,
  temErro,
  podeExcluir,
}: {
  inventarioId: number
  temErro: boolean
  podeExcluir: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function duplicar() {
    startTransition(async () => {
      const res = await duplicarInventario(inventarioId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else if (res?.id) {
        toast.success('Inventário duplicado')
        router.push(`/inventario/${res.id}/contagem`)
      }
    })
  }

  function reprocessar() {
    startTransition(async () => {
      const res = await forceSyncInventario(inventarioId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Itens com erro reprocessados')
        router.refresh()
      }
    })
  }

  function excluir() {
    if (!window.confirm('Excluir este inventário? Os ajustes já lançados no Omie serão removidos.'))
      return
    startTransition(async () => {
      const res = await excluirInventario(inventarioId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Inventário excluído')
        router.refresh()
      }
    })
  }

  return (
    <span className="inline-flex items-center gap-1 2xl:gap-2">
      <button
        onClick={duplicar}
        disabled={pending}
        className={btnLinhaClass('outline')}
        aria-label="Duplicar"
        title="Duplicar"
      >
        <Copy className="size-4" />
      </button>
      {temErro && (
        <button
          onClick={reprocessar}
          disabled={pending}
          className={btnLinhaClass('outline')}
          aria-label="Reenviar erros"
          title="Reenviar itens com erro ao Omie"
        >
          <RefreshCw className="size-4" />
        </button>
      )}
      {podeExcluir && (
        <button
          onClick={excluir}
          disabled={pending}
          className={btnLinhaClass('danger')}
          aria-label="Excluir"
          title="Excluir"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </span>
  )
}
