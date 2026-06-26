'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { btnClass } from './Button'

export function Paginacao({
  basePath,
  page,
  temProxima,
  total,
  porPagina = 50,
}: {
  basePath: string
  page: number
  temProxima: boolean
  total?: number
  porPagina?: number
}) {
  const sp = useSearchParams()

  function href(p: number): string {
    const params = new URLSearchParams(sp.toString())
    if (p <= 1) params.delete('page')
    else params.set('page', String(p))
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  const temAnterior = page > 1
  const inicio = (page - 1) * porPagina + 1
  const fim = temProxima ? page * porPagina : (page - 1) * porPagina + (total != null ? Math.min(total - (page - 1) * porPagina, porPagina) : porPagina)

  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      {temAnterior ? (
        <Link href={href(page - 1)} className={btnClass('outline')}>
          <ChevronLeft className="size-4" /> Anterior
        </Link>
      ) : (
        <span className={`${btnClass('outline')} pointer-events-none opacity-60`} aria-disabled="true">
          <ChevronLeft className="size-4" /> Anterior
        </span>
      )}

      {total != null ? (
        <span className="text-[13px] text-text-muted tabular-nums">
          {inicio.toLocaleString('pt-BR')}–{Math.min(fim, total).toLocaleString('pt-BR')} de{' '}
          <span className="font-medium text-text">{total.toLocaleString('pt-BR')}</span>
        </span>
      ) : (
        <span className="text-[13px] text-text-muted">Página {page}</span>
      )}

      {temProxima ? (
        <Link href={href(page + 1)} className={btnClass('outline')}>
          Próxima <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span className={`${btnClass('outline')} pointer-events-none opacity-60`} aria-disabled="true">
          Próxima <ChevronRight className="size-4" />
        </span>
      )}
    </div>
  )
}
