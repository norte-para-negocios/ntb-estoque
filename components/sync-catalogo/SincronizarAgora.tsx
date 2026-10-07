'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { sincronizarAgora } from '@/lib/actions/catalogo-proprio'
import { btnClass } from '@/components/ui-kit/Button'

export function SincronizarAgora() {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <button
      className={btnClass('primary')} disabled={pending}
      onClick={() => start(async () => {
        const r = await sincronizarAgora()
        if ('error' in r) { toast.error('Falha ao sincronizar', { description: r.error }); return }
        toast.success('Sincronizado', { description: r.resumo })
        router.refresh()
      })}
    >
      <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} />
      {pending ? 'Sincronizando…' : 'Sincronizar agora'}
    </button>
  )
}
