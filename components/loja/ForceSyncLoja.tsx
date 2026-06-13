'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { forceSyncLoja } from '@/lib/actions/loja'

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
    <Button variant="outline" size="sm" onClick={sincronizar} disabled={pending}>
      <RefreshCw className="size-4" />
      {pending ? 'Forçando...' : 'Forçar sync'}
    </Button>
  )
}
