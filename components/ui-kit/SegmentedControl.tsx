'use client'

import * as React from 'react'
import { motion } from 'motion/react'
import { SPRING_UI } from '@/lib/motion'

export type SegmentedOpcao = { value: string; label: React.ReactNode }

/**
 * Controle segmentado estilo Apple (mesmo do NTB Vendas): trilho cinza com a
 * opção ativa numa pílula branca que desliza entre as opções.
 */
export function SegmentedControl({
  opcoes,
  value,
  onChange,
  className = '',
  'aria-label': ariaLabel,
}: {
  opcoes: SegmentedOpcao[]
  value: string
  onChange: (v: string) => void
  className?: string
  'aria-label'?: string
}) {
  const id = React.useId()
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full shrink-0 self-start items-center overflow-x-auto rounded-[10px] bg-surface-2 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {opcoes.map((o) => {
        const ativo = value === o.value
        return (
          <button
            key={o.value || '_'}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => onChange(o.value)}
            className={`relative h-8 shrink-0 whitespace-nowrap rounded-[8px] px-3 text-[13px] font-semibold u-motion max-sm:h-9 ${
              ativo ? 'text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {ativo && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-[8px] bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
                transition={SPRING_UI}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
