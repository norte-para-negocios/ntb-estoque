'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { forceSyncLoja } from '@/lib/actions/loja'
import { btnClass } from '@/components/ui-kit/Button'

export function ForceSyncLoja({ lojaId }: { lojaId: number }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function sincronizar() {
    if (!window.confirm('Forçar nova sincronização desta loja? Os status serão zerados.')) return
    startTransition(async () => {
      const res = await forceSyncLoja(lojaId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Sincronização forçada')
        router.refresh()
      }
    })
  }

  return (
    <button type="button" onClick={sincronizar} disabled={pending} className={btnClass('outline')}>
      <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} />
      {pending ? 'Forçando...' : 'Forçar liberação p/ atualização'}
    </button>
  )
}
