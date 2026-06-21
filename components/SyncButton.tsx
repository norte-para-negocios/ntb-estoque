'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

export function SyncButton({
  endpoint,
  endpoints,
  label,
}: {
  endpoint?: string
  endpoints?: string[]
  label: string
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSync() {
    setLoading(true)
    try {
      // Um ou vários endpoints (ex.: "Atualizar tudo" dispara produtos + custos + previsão).
      const lista = endpoints ?? (endpoint ? [endpoint] : [])
      let total = 0
      for (const ep of lista) {
        const res = await fetch(ep, { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Falha na sincronização')
        if (data.registros != null) total += Number(data.registros) || 0
      }
      toast.success('Sincronização concluída', {
        description: total > 0 ? `${total} registros atualizados` : undefined,
      })
      router.refresh()
    } catch (e) {
      toast.error('Erro ao sincronizar', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={loading}
      title="O sistema sincroniza sozinho em segundo plano. Use para forçar agora."
      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-sm font-medium text-white u-motion u-press hover:bg-[var(--brand-strong)] disabled:opacity-60 disabled:active:scale-100 sm:px-3"
    >
      <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">{loading ? 'Sincronizando...' : label}</span>
    </button>
  )
}
