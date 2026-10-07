'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Power } from 'lucide-react'
import { toast } from 'sonner'
import { alternarAtivoLoja } from '@/lib/actions/loja'
import { btnClass } from '@/components/ui-kit/Button'

export function AtivarLoja({ lojaId, ativo }: { lojaId: number; ativo: boolean }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function alternar() {
    startTransition(async () => {
      const res = await alternarAtivoLoja(lojaId, !ativo)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success(ativo ? 'Loja desativada' : 'Loja ativada')
        router.refresh()
      }
    })
  }

  return (
    <button type="button" onClick={alternar} disabled={pending} className={btnClass('outline')}>
      <Power className="size-4" /> {ativo ? 'Desativar' : 'Ativar'}
    </button>
  )
}
