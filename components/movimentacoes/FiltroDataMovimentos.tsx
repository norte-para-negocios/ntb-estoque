'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'

interface Props {
  ini: string
  fim: string
}

export function FiltroDataMovimentos({ ini, fim }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [modo, setModo] = useState<'unica' | 'periodo'>(ini === fim ? 'unica' : 'periodo')
  const [dataUnica, setDataUnica] = useState(ini)
  const [inicio, setInicio] = useState(ini)
  const [final, setFinal] = useState(fim)

  useEffect(() => {
    setModo(ini === fim ? 'unica' : 'periodo')
    setDataUnica(ini)
    setInicio(ini)
    setFinal(fim)
  }, [ini, fim])

  function navegar(novoIni: string, novoFim: string) {
    const params = new URLSearchParams(sp.toString())
    if (novoIni) params.set('data_inicio', novoIni)
    else params.delete('data_inicio')
    if (novoFim) params.set('data_final', novoFim)
    else params.delete('data_final')
    params.delete('page')
    router.push(`/movimentacoes?${params.toString()}`)
  }

  function trocarModo(novoModo: 'unica' | 'periodo') {
    setModo(novoModo)
    if (novoModo === 'unica') navegar(inicio, inicio)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center rounded-lg border border-border bg-surface-2 p-0.5">
        <button
          onClick={() => trocarModo('unica')}
          className={`rounded-md px-3 py-1 text-[12px] transition-colors ${
            modo === 'unica' ? 'bg-surface font-medium text-text shadow-sm' : 'text-text-muted hover:text-text'
          }`}
        >
          Data única
        </button>
        <button
          onClick={() => trocarModo('periodo')}
          className={`rounded-md px-3 py-1 text-[12px] transition-colors ${
            modo === 'periodo' ? 'bg-surface font-medium text-text shadow-sm' : 'text-text-muted hover:text-text'
          }`}
        >
          Período
        </button>
      </div>

      {modo === 'unica' ? (
        <input
          type="date"
          value={dataUnica}
          onChange={(e) => setDataUnica(e.target.value)}
          onBlur={(e) => navegar(e.target.value, e.target.value)}
          className="num h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text outline-none transition-colors focus:border-brand"
        />
      ) : (
        <>
          <input
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            onBlur={(e) => navegar(e.target.value, final)}
            className="num h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text outline-none transition-colors focus:border-brand"
          />
          <span className="text-[12px] text-text-muted">até</span>
          <input
            type="date"
            value={final}
            onChange={(e) => setFinal(e.target.value)}
            onBlur={(e) => navegar(inicio, e.target.value)}
            className="num h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text outline-none transition-colors focus:border-brand"
          />
        </>
      )}
    </div>
  )
}
