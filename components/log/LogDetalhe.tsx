'use client'

import { useState } from 'react'

function formatar(raw: string | null): string {
  if (!raw) return '-'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function LogDetalhe({
  request,
  response,
}: {
  request: string | null
  response: string | null
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="mt-3">
      <button
        onClick={() => setAberto((a) => !a)}
        className="text-xs font-semibold text-[#2eb5c3] hover:underline"
      >
        {aberto ? 'Ocultar detalhes' : 'Ver detalhes'}
      </button>
      {aberto && (
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-[#8a8a8a]">Requisição</div>
            <pre className="max-h-64 overflow-x-auto rounded border border-[#d5d5d5] bg-[#f4f4f4] p-2 text-xs text-[#5d5d5d]">
              {formatar(request)}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-[#8a8a8a]">Resposta</div>
            <pre className="max-h-64 overflow-x-auto rounded border border-[#d5d5d5] bg-[#f4f4f4] p-2 text-xs text-[#5d5d5d]">
              {formatar(response)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
