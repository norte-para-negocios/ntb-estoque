'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { puxarEmpresaDoOmie } from '@/lib/actions/loja'
import { btnClass } from '@/components/ui-kit/Button'

export function PuxarEmpresa({ lojaId }: { lojaId: number }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function puxar() {
    startTransition(async () => {
      const res = await puxarEmpresaDoOmie(lojaId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Dados da empresa atualizados do Omie')
        router.refresh()
      }
    })
  }

  return (
    <button type="button" onClick={puxar} disabled={pending} className={btnClass('outline')}>
      <Building2 className={`size-4 ${pending ? 'animate-pulse' : ''}`} />
      {pending ? 'Puxando...' : 'Puxar dados do Omie'}
    </button>
  )
}
