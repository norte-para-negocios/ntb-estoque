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
  const hojeBahia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const [data, setData] = useState(hojeBahia)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function criar() {
    if (!local) {
      toast.error('Selecione um local de estoque')
      return
    }
    startTransition(async () => {
      const inv = await createInventario(Number(local), data)
      if (inv && 'error' in inv) {
        toast.error(inv.error)
        return
      }
      if (inv?.id) {
        toast.success('Inventário criado')
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
            <Plus className="size-4" /> Novo inventário
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo inventário</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Local de estoque</Label>
            <Select value={local} onValueChange={(val) => setLocal((val as string) ?? '')}>
              <SelectTrigger>
                <SelectValue>
                  {(v) => locais.find((l) => String(l.codigo_local_estoque) === v)?.descricao ?? 'Selecione o local'}
                </SelectValue>
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
          <div className="space-y-2">
            <Label>Data</Label>
            <input
              type="date"
              value={data}
              max={hojeBahia}
              onChange={(e) => setData(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand"
            />
            <p className="text-[11px] text-text-muted">
              Costuma-se considerar o dia anterior (D-1) quando a contagem é feita de manhã.
            </p>
          </div>
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
