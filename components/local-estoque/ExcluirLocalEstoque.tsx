'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { excluirLocalEstoque } from '@/lib/actions/local-estoque'
import { btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'

export function ExcluirLocalEstoque({ id, descricao }: { id: number; descricao: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function excluir() {
    if (!window.confirm(`Excluir o local "${descricao}" do banco local?\n\nEsta ação não remove o local no Omie.`)) return
    startTransition(async () => {
      const res = await excluirLocalEstoque(id)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Local excluído do banco local')
        router.refresh()
      }
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
