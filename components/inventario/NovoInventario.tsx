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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createInventario } from '@/lib/actions/inventario'

type Local = { codigo_local_estoque: number; descricao: string }

export function NovoInventario({ locais }: { locais: Local[] }) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<string>('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function criar() {
    if (!local) {
      toast.error('Selecione um local de estoque')
      return
    }
    startTransition(async () => {
      const inv = await createInventario(Number(local))
      if (inv?.id) {
        toast.success('Inventario criado')
        setOpen(false)
        router.push(`/inventario/${inv.id}/contagem`)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" /> Novo inventario
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo inventario</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Local de estoque</Label>
          <Select value={local} onValueChange={(val) => setLocal((val as string) ?? '')}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o local" />
            </SelectTrigger>
            <SelectContent>
              {locais.map((l) => (
                <SelectItem key={l.codigo_local_estoque} value={String(l.codigo_local_estoque)}>
                  {l.descricao}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={pending}>
            {pending ? 'Criando...' : 'Criar e contar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
