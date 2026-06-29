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
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-text-muted">Período:</span>
      <input
        type="date"
        value={inicio}
        onChange={(e) => setInicio(e.target.value)}
        onBlur={(e) => aplicar(e.target.value, final)}
        className="num h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text outline-none transition-colors focus:border-brand"
      />
      <span className="text-[12px] text-text-muted">até</span>
      <input
        type="date"
        value={final}
        onChange={(e) => setFinal(e.target.value)}
        onBlur={(e) => aplicar(inicio, e.target.value)}
        className="num h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text outline-none transition-colors focus:border-brand"
      />
    </div>
  )
}
