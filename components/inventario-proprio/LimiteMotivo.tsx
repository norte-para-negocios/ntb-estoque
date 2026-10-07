'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { salvarLimiteMotivo } from '@/lib/actions/inventario-proprio'

export function LimiteMotivo({ valor, podeEditar }: { valor: number; podeEditar: boolean }) {
  const router = useRouter()
  const [v, setV] = useState(String(valor).replace('.', ','))
  const [pending, start] = useTransition()
  function salvar() {
    start(async () => {
      const r = await salvarLimiteMotivo(v)
      if ('error' in r) { toast.error('Não salvou', { description: r.error }); return }
      toast.success('Limite atualizado')
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[var(--r-lg)] bg-surface p-4 u-card">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-text">Quando a diferença exige motivo</div>
        <p className="text-[12px] text-text-muted">Se a diferença de um item passar desse valor (em reais, a custo médio), quem fecha a contagem precisa explicar.</p>
      </div>
      <div className="relative w-32">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text-muted">R$</span>
        <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} disabled={!podeEditar} aria-label="Limite em reais"
          className="num w-full rounded-[var(--r-md)] border-0 bg-surface-2 py-2 pl-9 pr-3 text-right text-base text-text outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-60" />
      </div>
      {podeEditar && <button type="button" className={btnClass('outline')} onClick={salvar} disabled={pending}>Salvar</button>}
    </div>
  )
}
