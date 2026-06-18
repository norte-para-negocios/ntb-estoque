'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { excluirFamilia } from '@/lib/actions/familia'
import { btnClass } from '@/components/ui-kit/Button'

export function ExcluirFamilia({ id, nome }: { id: number; nome: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function excluir() {
    if (!window.confirm(`Excluir a família "${nome}"?`)) return
    startTransition(async () => {
      const res = await excluirFamilia(id)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Família excluída')
        router.refresh()
      }
    })
  }

  return (
    <button type="button" onClick={excluir} disabled={pending} className={btnClass('ghost')}>
      <Trash2 className="size-4" /> Excluir
    </button>
  )
}
