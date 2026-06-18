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
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { criarLocalEstoque } from '@/lib/actions/local-estoque'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand'

export function NovoLocalEstoque() {
  const [open, setOpen] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [codigo, setCodigo] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function criar() {
    if (!descricao.trim()) {
      toast.error('Informe a descrição do local')
      return
    }
    startTransition(async () => {
      const res = await criarLocalEstoque({ descricao, codigo })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Local criado no Omie')
      setOpen(false)
      setDescricao('')
      setCodigo('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" /> Novo local
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo local de estoque</DialogTitle>
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
            O local é criado direto no Omie e sincronizado de volta para o sistema.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={pending}>
            {pending && <Spinner />}
            {pending ? 'Criando...' : 'Criar no Omie'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
