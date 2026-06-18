'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export type SegmentOpcao = { value: string; label: string }

/**
 * Toggle/segmented control que troca o valor de UM searchParam preservando os
 * demais (filtros, ordenacao). Usado para alternar VALOR x QUANTIDADE e
 * POR DATA x POR MES na tela de movimentacoes. Reseta a paginacao ao trocar.
 *
 * O valor vazio ('') casa o default: quando o param nao esta na URL, a primeira
 * opcao (ou a de value '') fica marcada.
 */
export function SegmentLinks({
  basePath,
  param,
  opcoes,
  ['aria-label']: ariaLabel,
}: {
  basePath: string
  param: string
  opcoes: SegmentOpcao[]
  'aria-label'?: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const atual = sp.get(param) ?? ''

  function selecionar(value: string) {
    const params = new URLSearchParams(sp.toString())
    params.delete('page')
    if (value) params.set(param, value)
    else params.delete(param)
    const qs = params.toString()
    router.push(qs ? `${basePath}?${qs}` : basePath)
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 items-center rounded-md border border-border bg-surface-2 p-0.5"
    >
      {opcoes.map((o) => {
        const ativo = atual === o.value || (!atual && o.value === opcoes[0].value)
        return (
          <button
            key={o.value || '_'}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => selecionar(o.value)}
            className={`rounded-[5px] px-3 py-1 text-[13px] font-medium u-motion u-press-sm ${
              ativo
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
