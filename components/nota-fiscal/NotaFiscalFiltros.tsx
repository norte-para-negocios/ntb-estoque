'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Toolbar } from '@/components/ui-kit/Toolbar'
import { btnClass } from '@/components/ui-kit/Button'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'

const fieldClass =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none transition-colors focus:border-brand'
const labelClass = 'mb-1 block text-[11px] font-medium text-text-muted'

const CAMPOS = ['data_inicio', 'data_final', 'num_nfe', 'fornecedor', 'status', 'tipo', 'produto'] as const

export function NotaFiscalFiltros({
  defaults,
}: {
  defaults: {
    data_inicio: string
    data_final: string
    num_nfe: string
    fornecedor: string
    status: string
    tipo: string
    produto: string
  }
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const params = new URLSearchParams(searchParams.toString())
    params.delete('page')
    for (const key of CAMPOS) {
      const val = (form.get(key) as string) ?? ''
      if (val) params.set(key, val)
      else params.delete(key)
    }
    router.push(`/nota-fiscal?${params.toString()}`)
  }

  return (
    <Toolbar>
      <form onSubmit={onSubmit} className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
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
        <div>
          <label htmlFor="status" className={labelClass}>Status</label>
          <select id="status" name="status" defaultValue={defaults.status} className={fieldClass}>
            <option value="">Todos</option>
            <option value="P">Pendente</option>
            <option value="C">Concluida</option>
          </select>
        </div>
        <div>
          <label htmlFor="tipo" className={labelClass}>Tipo</label>
          <select id="tipo" name="tipo" defaultValue={defaults.tipo} className={fieldClass}>
            <option value="">Todos</option>
            {PRODUTO_TIPO_ITEM.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="produto" className={labelClass}>Produto</label>
          <input id="produto" name="produto" defaultValue={defaults.produto} placeholder="Nome ou código do item" className={fieldClass} />
        </div>
        <button type="submit" className={btnClass('primary')}>Filtrar</button>
      </form>
    </Toolbar>
  )
}
