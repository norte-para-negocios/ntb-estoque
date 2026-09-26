'use client'

import { useRouter } from 'next/navigation'
import { SegmentedControl } from '@/components/ui-kit/SegmentedControl'

/**
 * SegmentedControl cujas opcoes navegam para um href ja montado no server
 * (mesmos links que os toggles antigos usavam: Preços/Compras e a janela da
 * previsao). Mantem exatamente a mesma navegacao, so troca o visual.
 */
export function SegmentedHrefs({
  opcoes,
  value,
  'aria-label': ariaLabel,
}: {
  opcoes: { value: string; label: string; href: string }[]
  value: string
  'aria-label'?: string
}) {
  const router = useRouter()
  return (
    <SegmentedControl
      aria-label={ariaLabel}
      opcoes={opcoes.map(({ value, label }) => ({ value, label }))}
      value={value}
      onChange={(v) => {
        const o = opcoes.find((x) => x.value === v)
        if (o && v !== value) router.push(o.href)
      }}
    />
  )
}
