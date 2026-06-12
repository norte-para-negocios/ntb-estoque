'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
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
    <Button onClick={handleSync} disabled={loading} variant="outline">
      <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
      {loading ? 'Sincronizando...' : label}
    </Button>
  )
}
