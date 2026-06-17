'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { excluirProduto } from '@/lib/actions/produto'

// Excluir produto (C2). ESCREVE no Omie -> pede confirmacao inline (2 cliques).
export function ExcluirProdutoBtn({ codigoProduto }: { codigoProduto: number }) {
  const [confirmando, setConfirmando] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function excluir() {
    startTransition(async () => {
      const res = await excluirProduto(codigoProduto)
      if (res?.error) toast.error('Erro ao excluir', { description: res.error })
      else {
        toast.success('Produto excluído no Omie')
        router.refresh()
      }
      setConfirmando(false)
    })
  }

  if (confirmando) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
        <button
          type="button"
          onClick={excluir}
          disabled={pending}
          className="font-medium text-err hover:underline disabled:opacity-60"
        >
          {pending ? '...' : 'Excluir'}
        </button>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          disabled={pending}
          className="text-text-muted hover:underline disabled:opacity-60"
        >
          Cancelar
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirmando(true)}
      className="flex size-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-err"
      aria-label="Excluir produto"
      title="Excluir produto no Omie"
    >
      <Trash2 className="size-4" />
    </button>
  )
}
