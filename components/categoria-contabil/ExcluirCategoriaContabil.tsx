'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { excluirCategoriaContabil } from '@/lib/actions/categoria-contabil'
import { btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'

export function ExcluirCategoriaContabil({ id, nome }: { id: number; nome: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function excluir() {
    if (!window.confirm(`Excluir a categoria "${nome}"? Itens de NF já classificados com ela ficam sem categoria.`)) return
    startTransition(async () => {
      const res = await excluirCategoriaContabil(id)
      if (res?.error) { toast.error('Erro', { description: res.error }); return }
      toast.success('Categoria excluída')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={excluir}
      disabled={pending}
      className={btnLinhaClass('ghost')}
      aria-label="Excluir"
      title="Excluir"
    >
      <Trash2 className="size-4" /> <RotuloAcao>Excluir</RotuloAcao>
    </button>
  )
}
