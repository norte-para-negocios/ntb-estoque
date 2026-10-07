'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Combobox } from '@/components/ui-kit/Combobox'

/** Escolhe o produto que vai ganhar a ficha e abre o editor. */
export function NovaFicha({ produtos }: { produtos: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const [produto, setProduto] = useState('')
  const router = useRouter()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button type="button" className={btnClass('primary')}><Plus className="size-4" />Nova ficha</button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova ficha técnica</DialogTitle>
          <p className="text-[13px] text-text-muted">Escolha o prato ou preparo. Em seguida você monta a lista de insumos.</p>
        </DialogHeader>
        <Combobox options={produtos} value={produto} onChange={setProduto} placeholder="Buscar produto..." />
        <DialogFooter>
          <button type="button" className={btnClass('primary')} disabled={!produto} onClick={() => router.push(`/ficha-tecnica/${produto}`)}>
            Continuar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
