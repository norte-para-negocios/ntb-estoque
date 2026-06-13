'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
    <button
      type="button"
      onClick={excluir}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded bg-[#ff595e] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#e8484d] disabled:opacity-60"
    >
      <Trash2 className="size-4" /> Excluir
    </button>
  )
}
