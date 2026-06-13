'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { btnClass } from './Button'

export function Paginacao({
  basePath,
  page,
  temProxima,
}: {
  basePath: string
  page: number
  temProxima: boolean
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

      <span className="text-[13px] text-text-muted">Página {page}</span>

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
