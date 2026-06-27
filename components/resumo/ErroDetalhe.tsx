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
        className={`cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-semibold u-motion u-press-sm hover:opacity-80 ${tomClasse}`}
        title="Ver o erro completo"
      >
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
            className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-text">{titulo ?? 'Detalhe do erro'}</h3>
              <button onClick={() => setAberto(false)} className="text-text-muted hover:text-text" aria-label="Fechar">
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
