'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

export function SyncButton({ endpoint, label }: { endpoint: string; label: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSync() {
    setLoading(true)
    try {
      const res = await fetch(endpoint, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha na sincronização')
      toast.success('Sincronização concluída', {
        description: data.registros != null ? `${data.registros} registros atualizados` : undefined,
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
      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[var(--brand-strong)] active:scale-[0.98] disabled:opacity-60"
    >
      <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
      {loading ? 'Sincronizando...' : label}
    </button>
  )
}
