'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { puxarEmpresaDoOmie } from '@/lib/actions/loja'
import { btnClass } from '@/components/ui-kit/Button'

export function PuxarEmpresa({ lojaId }: { lojaId: number }) {
  const [pending, startTransition] = useTransition()
  // Trava anti-rajada: o Omie bloqueia chamadas iguais repetidas em curto
  // intervalo (Consumo Indevido). Apos puxar, o botao fica em cooldown de 60s.
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
      const res = await puxarEmpresaDoOmie(lojaId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Dados da empresa atualizados do Omie')
        router.refresh()
      }
      setCooldown(60)
    })
  }

  return (
    <button
      type="button"
      onClick={puxar}
      disabled={pending || cooldown > 0}
      className={btnClass('outline')}
    >
      <Building2 className={`size-4 ${pending ? 'animate-pulse' : ''}`} />
      {pending ? 'Puxando...' : cooldown > 0 ? `Aguarde ${cooldown}s` : 'Puxar dados do Omie'}
    </button>
  )
}
