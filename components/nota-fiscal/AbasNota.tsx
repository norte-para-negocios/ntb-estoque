'use client'

import { useState, type ReactNode } from 'react'
import { SegmentedControl } from '@/components/ui-kit/SegmentedControl'

export type AbaNota = { id: string; label: string; conteudo: ReactNode }

/** Informação secundária da nota (fiscal, histórico, anexos…) em abas: nada some, só sai da frente. Todas as abas ficam montadas; a inativa só se esconde. */
export function AbasNota({ abas, inicial }: { abas: AbaNota[]; inicial?: string }) {
  const [ativa, setAtiva] = useState(inicial && abas.some((a) => a.id === inicial) ? inicial : abas[0]?.id ?? '')
  if (!abas.length) return null
  return (
    <section className="space-y-3" aria-label="Detalhes da nota">
      <SegmentedControl aria-label="Detalhes da nota" opcoes={abas.map((a) => ({ value: a.id, label: a.label }))} value={ativa} onChange={setAtiva} />
      {abas.map((a) => (
        <div key={a.id} role="tabpanel" hidden={a.id !== ativa} className="space-y-4">{a.conteudo}</div>
      ))}
    </section>
  )
}
