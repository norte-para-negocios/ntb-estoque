'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { SegmentedControl } from './SegmentedControl'

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

  const valor = opcoes.some((o) => o.value === atual) ? atual : opcoes[0]?.value ?? ''
  return (
    <SegmentedControl
      aria-label={ariaLabel}
      opcoes={opcoes}
      value={valor}
      onChange={selecionar}
    />
  )
}
