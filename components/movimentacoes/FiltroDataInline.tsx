'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'

interface Props {
  ini: string
  fim: string
}

export function FiltroDataInline({ ini, fim }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [inicio, setInicio] = useState(ini)
  const [final, setFinal] = useState(fim)

  // Sincroniza se o servidor mudar os valores (ex: limpar filtros)
  useEffect(() => { setInicio(ini) }, [ini])
  useEffect(() => { setFinal(fim) }, [fim])

  function aplicar(novoInicio: string, novoFinal: string) {
    const params = new URLSearchParams(sp.toString())
    if (novoInicio) params.set('data_inicio', novoInicio)
    else params.delete('data_inicio')
    if (novoFinal) params.set('data_final', novoFinal)
    else params.delete('data_final')
    params.delete('page')
    router.push(`/movimentacoes?${params.toString()}`)
  }

  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-2">
      <span className="shrink-0 text-[13px] text-text-muted">Período:</span>
      <input
        type="date"
        value={inicio}
        onChange={(e) => setInicio(e.target.value)}
        onBlur={(e) => aplicar(e.target.value, final)}
        className="num h-9 min-w-0 flex-1 rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 text-[13px] text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40 sm:w-[140px] sm:flex-none max-sm:h-10 max-sm:text-base"
      />
      <span className="shrink-0 text-[13px] text-text-muted">até</span>
      <input
        type="date"
        value={final}
        onChange={(e) => setFinal(e.target.value)}
        onBlur={(e) => aplicar(inicio, e.target.value)}
        className="num h-9 min-w-0 flex-1 rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 text-[13px] text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40 sm:w-[140px] sm:flex-none max-sm:h-10 max-sm:text-base"
      />
    </div>
  )
}
