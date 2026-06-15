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
import {
  createTransferencia,
  TIPOS_TRANSFERENCIA,
  type TipoTransferencia,
} from '@/lib/actions/transferencia'

type Local = { codigo_local_estoque: number; descricao: string }

export function NovaTransferencia({ locais }: { locais: Local[] }) {
  const [open, setOpen] = useState(false)
  const [origem, setOrigem] = useState('')
  const [destino, setDestino] = useState('')
  const [tipo, setTipo] = useState<TipoTransferencia>('TRF')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function criar() {
    if (!origem || !destino) {
      toast.error('Selecione origem e destino')
      return
    }
    if (origem === destino) {
      toast.error('Origem e destino devem ser diferentes')
      return
    }
    startTransition(async () => {
      const res = await createTransferencia({
        codigoLocalOrigem: Number(origem),
        codigoLocalDestino: Number(destino),
        tipo,
      })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      if (res?.id) {
        toast.success('Transferência criada')
        setOpen(false)
        router.push(`/transferencia/${res.id}/contagem`)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" /> Nova transferência
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova transferência</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Origem</Label>
            <Select value={origem} onValueChange={(v) => setOrigem((v as string) ?? '')}>
              <SelectTrigger>
                <SelectValue placeholder="Local de origem" />
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
            <Label>Destino</Label>
            <Select value={destino} onValueChange={(v) => setDestino((v as string) ?? '')}>
              <SelectTrigger>
                <SelectValue placeholder="Local de destino" />
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
            <Label>Tipo de transferência</Label>
            <Select value={tipo} onValueChange={(v) => setTipo((v as TipoTransferencia) ?? 'TRF')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIPOS_TRANSFERENCIA).map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor}>
                    {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
