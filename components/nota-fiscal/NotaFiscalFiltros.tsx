'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Toolbar } from '@/components/ui-kit/Toolbar'
import { btnClass } from '@/components/ui-kit/Button'

const fieldClass =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none transition-colors focus:border-brand'
const labelClass = 'mb-1 block text-[11px] font-medium text-text-muted'

export function NotaFiscalFiltros({
  defaults,
}: {
  defaults: { data_inicio: string; data_final: string; num_nfe: string; fornecedor: string }
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const params = new URLSearchParams(searchParams.toString())
    for (const key of ['data_inicio', 'data_final', 'num_nfe', 'fornecedor']) {
      const val = form.get(key) as string
      if (val) params.set(key, val)
      else params.delete(key)
    }
    router.push(`/nota-fiscal?${params.toString()}`)
  }

  return (
    <Toolbar>
      <form onSubmit={onSubmit} className="grid grid-cols-1 items-end gap-3 md:grid-cols-5">
        <div>
          <label htmlFor="data_inicio" className={labelClass}>Data Início</label>
          <input id="data_inicio" name="data_inicio" type="date" defaultValue={defaults.data_inicio} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="data_final" className={labelClass}>Data Final</label>
          <input id="data_final" name="data_final" type="date" defaultValue={defaults.data_final} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="num_nfe" className={labelClass}>Nº NFe</label>
          <input id="num_nfe" name="num_nfe" defaultValue={defaults.num_nfe} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="fornecedor" className={labelClass}>Fornecedor</label>
          <input id="fornecedor" name="fornecedor" defaultValue={defaults.fornecedor} className={fieldClass} />
        </div>
        <button type="submit" className={btnClass('primary')}>Filtrar</button>
      </form>
    </Toolbar>
  )
}
