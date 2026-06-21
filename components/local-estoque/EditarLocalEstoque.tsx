'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui-kit/Spinner'
import { btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { editarLocalEstoque } from '@/lib/actions/local-estoque'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand'

export function EditarLocalEstoque({
  codigoLocalEstoque,
  descricaoAtual,
  codigoAtual,
}: {
  codigoLocalEstoque: number
  descricaoAtual: string
  codigoAtual: string
}) {
  const [open, setOpen] = useState(false)
  const [descricao, setDescricao] = useState(descricaoAtual)
  const [codigo, setCodigo] = useState(codigoAtual)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function salvar() {
    if (!descricao.trim()) {
      toast.error('Informe a descrição do local')
      return
    }
    startTransition(async () => {
      const res = await editarLocalEstoque({ codigoLocalEstoque, descricao, codigo })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Local alterado no Omie')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button type="button" className={btnLinhaClass('ghost')} aria-label="Editar" title="Editar local">
            <Pencil className="size-4" /> <RotuloAcao>Editar</RotuloAcao>
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar local de estoque</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Descrição</Label>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className={inputClass}
              placeholder="Ex.: Depósito, Câmara fria, Bar..."
            />
          </div>
          <div className="space-y-2">
            <Label>Código (opcional)</Label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className={inputClass}
              placeholder="Código interno"
            />
          </div>
          <p className="text-[12px] text-text-muted">
            A alteração é gravada direto no Omie e sincronizada de volta para o sistema.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={pending}>
            {pending && <Spinner />}
            {pending ? 'Salvando...' : 'Salvar no Omie'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
