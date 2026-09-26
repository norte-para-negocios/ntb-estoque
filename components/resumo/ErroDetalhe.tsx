'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

/**
 * Selo de erro CLICAVEL: mostra o status (Resolver/Temporario/Ver erro) e, ao
 * clicar, abre a mensagem completa do erro do Omie num popup. Resolve o pedido
 * do fundador: "clicar na bolinha do erro e aparecer o erro que aconteceu".
 */
export function ErroDetalhe({
  label,
  tomClasse,
  mensagem,
  titulo,
}: {
  label: string
  tomClasse: string
  mensagem: string
  titulo?: string
}) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text underline-offset-2 u-motion u-press-sm hover:underline"
        title="Ver o erro completo"
      >
        <span className={`size-2 shrink-0 rounded-full ${tomClasse}`} />
        {label}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setAberto(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-lg rounded-[22px] bg-surface p-5 text-left shadow-[var(--shadow-md)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[17px] font-semibold text-text">{titulo ?? 'Detalhe do erro'}</h3>
              <button onClick={() => setAberto(false)} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted u-motion hover:text-text" aria-label="Fechar">
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-muted">
              {mensagem}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
