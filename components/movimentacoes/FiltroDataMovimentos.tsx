'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { SegmentedControl } from '@/components/ui-kit/SegmentedControl'

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
    <div className="flex shrink-0 flex-nowrap items-center gap-2">
      <SegmentedControl
        aria-label="Tipo de data"
        opcoes={[
          { value: 'unica', label: 'Data única' },
          { value: 'periodo', label: 'Período' },
        ]}
        value={modo}
        onChange={(v) => trocarModo(v as 'unica' | 'periodo')}
      />

      {modo === 'unica' ? (
        <input
          type="date"
          value={dataUnica}
          onChange={(e) => setDataUnica(e.target.value)}
          onBlur={(e) => navegar(e.target.value, e.target.value)}
          className="num h-9 shrink-0 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 text-[13px] text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40 max-sm:h-10 max-sm:text-base"
        />
      ) : (
        <>
          <input
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            onBlur={(e) => navegar(e.target.value, final)}
            className="num h-9 shrink-0 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 text-[13px] text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40 max-sm:h-10 max-sm:text-base"
          />
          <span className="shrink-0 text-[13px] text-text-muted">até</span>
          <input
            type="date"
            value={final}
            onChange={(e) => setFinal(e.target.value)}
            onBlur={(e) => navegar(inicio, e.target.value)}
            className="num h-9 shrink-0 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 text-[13px] text-text outline-none transition-colors focus:ring-2 focus:ring-brand/40 max-sm:h-10 max-sm:text-base"
          />
        </>
      )}
    </div>
  )
}
