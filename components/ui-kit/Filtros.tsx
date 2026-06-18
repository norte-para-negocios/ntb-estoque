'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Toolbar } from './Toolbar'
import { btnClass } from './Button'

export type CampoFiltro =
  | { tipo: 'texto'; nome: string; label: string }
  | { tipo: 'data'; nome: string; label: string }
  | { tipo: 'select'; nome: string; label: string; opcoes: { value: string; label: string }[] }

const field =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none u-motion focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)]'
const lab = 'mb-1 block text-[11px] font-medium text-text-muted'

export function Filtros({
  basePath,
  campos,
  defaults,
}: {
  basePath: string
  campos: CampoFiltro[]
  defaults: Record<string, string>
}) {
  const router = useRouter()
  const sp = useSearchParams()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const params = new URLSearchParams(sp.toString())
    params.delete('page') // reset paginação ao filtrar
    for (const c of campos) {
      const v = ((form.get(c.nome) as string) ?? '').trim()
      if (v) params.set(c.nome, v)
      else params.delete(c.nome)
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  function limpar() {
    router.push(basePath)
  }

  return (
    <Toolbar>
      <form onSubmit={onSubmit} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {campos.map((c) => (
          <div key={c.nome}>
            <label htmlFor={c.nome} className={lab}>
              {c.label}
            </label>
            {c.tipo === 'select' ? (
              <select id={c.nome} name={c.nome} defaultValue={defaults[c.nome] ?? ''} className={field}>
                <option value="">Todos</option>
                {c.opcoes.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={c.nome}
                name={c.nome}
                type={c.tipo === 'data' ? 'date' : 'text'}
                defaultValue={defaults[c.nome] ?? ''}
                className={field}
              />
            )}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button type="submit" className={btnClass('primary')}>
            Filtrar
          </button>
          <button type="button" onClick={limpar} className={btnClass('ghost')}>
            Limpar
          </button>
        </div>
      </form>
    </Toolbar>
  )
}
