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
import { CamposLocalProprio, CAMPOS_LOCAL_PADRAO, type CamposLocal } from './CamposLocalProprio'

const inputClass =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none max-sm:text-base focus:ring-2 focus:ring-brand/40'

export function EditarLocalEstoque({
  codigoLocalEstoque,
  descricaoAtual,
  codigoAtual,
  proprio = false,
  extrasAtuais,
}: {
  codigoLocalEstoque: number
  descricaoAtual: string
  codigoAtual: string
  proprio?: boolean
  extrasAtuais?: CamposLocal
}) {
  const [open, setOpen] = useState(false)
  const [descricao, setDescricao] = useState(descricaoAtual)
  const [codigo, setCodigo] = useState(codigoAtual)
  const [extras, setExtras] = useState<CamposLocal>(extrasAtuais ?? CAMPOS_LOCAL_PADRAO)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function salvar() {
    if (!descricao.trim()) {
      toast.error('Informe a descrição do local')
      return
    }
    startTransition(async () => {
      const res = await editarLocalEstoque(proprio ? { codigoLocalEstoque, descricao, codigo, ...extras } : { codigoLocalEstoque, descricao, codigo })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(proprio ? 'Local alterado' : 'Local alterado no Omie')
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
          {proprio ? (
            <CamposLocalProprio valor={extras} onChange={setExtras} mostrarInativo />
          ) : (
            <p className="text-[12px] text-text-muted">
              A alteração é gravada direto no Omie e sincronizada de volta para o sistema.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={pending}>
            {pending && <Spinner />}
            {pending ? 'Salvando...' : proprio ? 'Salvar' : 'Salvar no Omie'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
