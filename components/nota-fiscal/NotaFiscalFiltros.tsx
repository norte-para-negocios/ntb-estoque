'use client'

import { useRouter, useSearchParams } from 'next/navigation'

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
    <div className="ntb-card">
      <div className="ntb-card-body">
        <form onSubmit={onSubmit} className="grid grid-cols-1 items-end gap-3 md:grid-cols-5">
          <div>
            <label htmlFor="data_inicio" className="ntb-label">Data Início</label>
            <input id="data_inicio" name="data_inicio" type="date" defaultValue={defaults.data_inicio} className="ntb-input" />
          </div>
          <div>
            <label htmlFor="data_final" className="ntb-label">Data Final</label>
            <input id="data_final" name="data_final" type="date" defaultValue={defaults.data_final} className="ntb-input" />
          </div>
          <div>
            <label htmlFor="num_nfe" className="ntb-label">Nº NFe</label>
            <input id="num_nfe" name="num_nfe" defaultValue={defaults.num_nfe} className="ntb-input" />
          </div>
          <div>
            <label htmlFor="fornecedor" className="ntb-label">Fornecedor</label>
            <input id="fornecedor" name="fornecedor" defaultValue={defaults.fornecedor} className="ntb-input" />
          </div>
          <button type="submit" className="ntb-btn-success justify-center">Filtrar</button>
        </form>
      </div>
    </div>
  )
}
