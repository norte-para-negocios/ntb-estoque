'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { btnLinhaClass, btnClass } from '@/components/ui-kit/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
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

  // Duplicar pede a data ANTES de criar (dialog), em vez de sempre usar hoje.
  const hojeBahia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const [dialogDuplicar, setDialogDuplicar] = useState(false)
  const [dataDuplicar, setDataDuplicar] = useState(hojeBahia)

  function duplicar() {
    startTransition(async () => {
      const res = await duplicarInventario(inventarioId, dataDuplicar)
      if (res?.error) toast.error('Erro', { description: res.error })
      else if (res?.id) {
        toast.success('Inventário duplicado')
        setDialogDuplicar(false)
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
        onClick={() => setDialogDuplicar(true)}
        disabled={pending}
        className={btnLinhaClass('outline')}
        aria-label="Duplicar"
        title="Duplicar"
      >
        <Copy className="size-4" />
      </button>
      <Dialog open={dialogDuplicar} onOpenChange={setDialogDuplicar}>
        <DialogContent className="bg-surface" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="size-4 text-brand" />
              Duplicar inventário
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <label className="block text-[13px] font-medium text-text-muted">Data do novo inventário</label>
            <input
              type="date"
              value={dataDuplicar}
              max={hojeBahia}
              onChange={(e) => setDataDuplicar(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus:border-brand disabled:opacity-60"
            />
            <p className="text-[11px] text-text-muted">
              Mesmo local e itens do original, contagem zerada. Padrão: hoje.
            </p>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDialogDuplicar(false)}
              disabled={pending}
              className={btnClass('ghost')}
            >
              Cancelar
            </button>
            <button type="button" onClick={duplicar} disabled={pending} className={btnClass('primary')}>
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
