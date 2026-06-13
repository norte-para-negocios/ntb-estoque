'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { excluirLoja } from '@/lib/actions/loja'

export function ExcluirLoja({ lojaId, nome }: { lojaId: number; nome: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function excluir() {
    if (
      !window.confirm(
        `Excluir a loja "${nome}"? Todos os dados vinculados (produtos, notas, etc.) serão removidos.`
      )
    )
      return
    startTransition(async () => {
      const res = await excluirLoja(lojaId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Loja excluída')
        router.refresh()
      }
    })
  }

  return (
    <Button variant="destructive" size="sm" onClick={excluir} disabled={pending}>
      <Trash2 className="size-4" /> Excluir
    </Button>
  )
}
