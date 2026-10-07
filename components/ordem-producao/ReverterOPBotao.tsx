'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { reverterOP } from '@/lib/actions/ordem-producao'

// Botão "Reverter a conclusão" da tela de detalhe da OP (estoque próprio): estorna no ledger os movimentos da produção.
export function ReverterOPBotao({ opId, numOP }: { opId: number; numOP: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  function reverter() {
    if (!window.confirm(`Reverter a conclusão da OP ${numOP}? O produto sai do estoque e os insumos voltam; os movimentos originais ficam no histórico como estornados.`)) return
    startTransition(async () => {
      const res = await reverterOP(opId)
      if (res && 'error' in res && res.error) toast.error('Erro ao reverter', { description: res.error })
      else {
        toast.success('Conclusão revertida')
        router.refresh()
      }
    })
  }
  return (
    <button type="button" onClick={reverter} disabled={pending} className={btnClass('outline')}>
      {pending ? <Spinner /> : <Undo2 className="size-4" />} Reverter conclusão
    </button>
  )
}
