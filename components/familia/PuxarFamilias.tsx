'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { puxarFamiliasDoOmie } from '@/lib/actions/familia'
import { btnClass } from '@/components/ui-kit/Button'

export function PuxarFamilias() {
  const [pending, startTransition] = useTransition()
  // Cooldown anti-rajada: o Omie bloqueia chamadas repetidas em curto intervalo.
  const [cooldown, setCooldown] = useState(0)
  const router = useRouter()

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  function puxar() {
    if (pending || cooldown > 0) return
    startTransition(async () => {
      const res = await puxarFamiliasDoOmie()
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Famílias atualizadas do Omie')
        router.refresh()
      }
      setCooldown(60)
    })
  }

  return (
    <button type="button" onClick={puxar} disabled={pending || cooldown > 0} className={btnClass('outline')}>
      <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} />
      {pending ? 'Puxando...' : cooldown > 0 ? `Aguarde ${cooldown}s` : 'Puxar do Omie'}
    </button>
  )
}
