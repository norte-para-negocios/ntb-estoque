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
    <div className="mt-2">
      <button
        onClick={() => setAberto((a) => !a)}
        className="text-xs text-blue-600 hover:underline"
      >
        {aberto ? 'Ocultar detalhes' : 'Ver detalhes'}
      </button>
      {aberto && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1">Requisicao</div>
            <pre className="text-xs bg-gray-50 border rounded p-2 overflow-x-auto max-h-64">
              {formatar(request)}
            </pre>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1">Resposta</div>
            <pre className="text-xs bg-gray-50 border rounded p-2 overflow-x-auto max-h-64">
              {formatar(response)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
