'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { btnLinhaClass, btnClass, RotuloAcao } from '@/components/ui-kit/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui-kit/Spinner'
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
  const [dialogAberto, setDialogAberto] = useState(false)
  const hojeBahia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const [dataNova, setDataNova] = useState(hojeBahia)

  function duplicar() {
    startTransition(async () => {
      const res = await duplicarTransferencia(transferenciaId, dataNova)
      if (res?.error) toast.error('Erro', { description: res.error })
      else if (res?.id) {
        toast.success('Transferência duplicada')
        setDialogAberto(false)
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
    <span className="inline-flex items-center gap-1 2xl:gap-2">
      <Dialog
        open={dialogAberto}
        onOpenChange={(open) => {
          setDialogAberto(open)
          if (open) setDataNova(hojeBahia)
        }}
      >
        <button
          onClick={() => setDialogAberto(true)}
          disabled={pending}
          className={btnLinhaClass('outline')}
          aria-label="Duplicar"
          title="Duplicar"
        >
          <Copy className="size-4" /> <RotuloAcao>Duplicar</RotuloAcao>
        </button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicar transferência</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Data da nova transferência</Label>
            <input
              type="date"
              value={dataNova}
              max={hojeBahia}
              onChange={(e) => setDataNova(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand"
            />
          </div>
          <DialogFooter>
            <button onClick={duplicar} disabled={pending} className={btnClass('primary')}>
              {pending && <Spinner />}
              {pending ? 'Duplicando...' : 'Duplicar'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {temErro && (
        <button
          onClick={reprocessar}
          disabled={pending}
          className={btnLinhaClass('outline')}
          aria-label="Reprocessar"
          title="Reprocessar itens com erro"
        >
          <RefreshCw className="size-4" /> <RotuloAcao>Reprocessar</RotuloAcao>
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
          <Trash2 className="size-4" /> <RotuloAcao>Excluir</RotuloAcao>
        </button>
      )}
    </span>
  )
}
