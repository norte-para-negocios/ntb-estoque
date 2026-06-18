'use client'

import { useState, useTransition } from 'react'
import { RotateCw } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { reprocessarSync, type SyncModel } from '@/lib/actions/sync-status'

export function ReprocessarErro({ lojaId, model }: { lojaId: number; model: SyncModel }) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function handleClick() {
    setErro(null)
    startTransition(async () => {
      const res = await reprocessarSync(lojaId, model)
      if (!res.ok) setErro(res.erro ?? 'Falha ao reprocessar.')
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={btnClass('outline')}
      >
        <RotateCw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} strokeWidth={2} />
        {pending ? 'Reprocessando' : 'Reprocessar'}
      </button>
      {erro && <span className="text-[11px] text-err">{erro}</span>}
    </div>
  )
}
