'use client'

import { useState } from 'react'

export function SincronizarBotoes() {
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [carregando, setCarregando] = useState<string | null>(null)

  async function chamar(rota: string, label: string) {
    setCarregando(label)
    setMensagem(null)
    try {
      const res = await fetch(rota, { method: 'POST' })
      const json = await res.json()
      setMensagem(res.ok ? `${label}: ${JSON.stringify(json)}` : `Erro em ${label}: ${json.error}`)
    } catch (e) {
      setMensagem(`Erro em ${label}: ${e instanceof Error ? e.message : 'falha desconhecida'}`)
    } finally {
      setCarregando(null)
      window.location.reload()
    }
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Os botões sincronizam a loja ativa na sua sessão (veja o menu lateral), que
        pode ser diferente da loja selecionada no filtro acima. Troque de loja pelo
        seletor do menu lateral antes de sincronizar.
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <button
          type="button"
          disabled={carregando !== null}
          onClick={() => chamar('/api/sync/ficha-tecnica-local', 'Sincronizar ficha técnica')}
          className="border rounded px-3 py-1 disabled:opacity-50"
        >
          {carregando === 'Sincronizar ficha técnica' ? 'Sincronizando...' : 'Sincronizar ficha técnica'}
        </button>
        <button
          type="button"
          disabled={carregando !== null}
          onClick={() => chamar('/api/sync/estoque-local', 'Sincronizar saldo inicial')}
          className="border rounded px-3 py-1 disabled:opacity-50"
        >
          {carregando === 'Sincronizar saldo inicial' ? 'Sincronizando...' : 'Sincronizar saldo inicial'}
        </button>
        {mensagem && <span className="text-sm">{mensagem}</span>}
      </div>
    </div>
  )
}
