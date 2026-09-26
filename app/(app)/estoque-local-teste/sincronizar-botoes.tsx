'use client'

import { useState } from 'react'
import { btnClass } from '@/components/ui-kit/Button'

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
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-[var(--r-lg)] bg-surface p-3 text-[13px] text-text shadow-[var(--shadow-sm)]">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warn" />
        <span>
        Os botões sincronizam a loja ativa na sua sessão (veja o menu lateral), que
        pode ser diferente da loja selecionada no filtro acima. Troque de loja pelo
        seletor do menu lateral antes de sincronizar.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={carregando !== null}
          onClick={() => chamar('/api/sync/ficha-tecnica-local', 'Sincronizar ficha técnica')}
          className={btnClass('outline')}
        >
          {carregando === 'Sincronizar ficha técnica' ? 'Sincronizando...' : 'Sincronizar ficha técnica'}
        </button>
        <button
          type="button"
          disabled={carregando !== null}
          onClick={() => chamar('/api/sync/estoque-local', 'Sincronizar saldo inicial')}
          className={btnClass('outline')}
        >
          {carregando === 'Sincronizar saldo inicial' ? 'Sincronizando...' : 'Sincronizar saldo inicial'}
        </button>
      </div>
      {mensagem && (
        <div className="flex items-start gap-2 rounded-[var(--r-lg)] bg-surface p-3 text-[13px] text-text shadow-[var(--shadow-sm)]">
          <span className="min-w-0 flex-1 break-words font-mono text-[12px]">{mensagem}</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`${btnClass('outline')} shrink-0`}
          >
            Atualizar página
          </button>
        </div>
      )}
    </div>
  )
}
