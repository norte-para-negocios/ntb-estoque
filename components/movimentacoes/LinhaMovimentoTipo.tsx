'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DetalheMovimentoSheet, type OrigemMovimento } from '@/components/movimentacoes/DetalheMovimentoSheet'

export function LinhaMovimentoTipo({
  label,
  cor,
  obs,
  origem,
}: {
  label: string
  cor: string
  obs: string | null
  origem?: OrigemMovimento
}) {
  const [aberto, setAberto] = useState<OrigemMovimento | null>(null)
  const router = useRouter()

  const conteudo = (
    <span>
      <span className={`font-medium text-[13px] ${cor}`}>{label}</span>
      {obs && (
        <span className="block max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-text-muted">
          {obs}
        </span>
      )}
    </span>
  )

  if (!origem) return conteudo

  return (
    <>
      <button type="button" onClick={() => setAberto(origem)} className="text-left hover:opacity-80">
        {conteudo}
      </button>
      <DetalheMovimentoSheet
        origem={aberto}
        onOpenChange={(o) => {
          setAberto(o)
          if (o === null) router.refresh() // reflete reverter/edicoes feitas dentro da gaveta
        }}
      />
    </>
  )
}
