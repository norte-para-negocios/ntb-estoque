'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { excluirProdutoSubstituicao } from '@/lib/actions/produto-substituicao'

export function ExcluirProdutoSubstituicao({ id, descricao }: { id: number; descricao: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function excluir() {
    if (!window.confirm(`Remover o vínculo de substituição de "${descricao}"?`)) return
    startTransition(async () => {
      const res = await excluirProdutoSubstituicao(id)
      if (res?.error) { toast.error('Erro', { description: res.error }); return }
      toast.success('Vínculo removido')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={excluir}
      disabled={pending}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-err u-motion u-press hover:bg-surface-2 disabled:opacity-60"
      aria-label="Remover"
      title="Remover"
    >
      <Trash2 className="size-4" />
    </button>
  )
}
