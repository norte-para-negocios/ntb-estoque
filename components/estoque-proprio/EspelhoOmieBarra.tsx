'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Faixa "Espelho do Omie": hora da última leitura, avisos e botão de atualizar (só leitura do Omie). */
export function EspelhoOmieBarra({ atualizadoEm, locaisSemLeitura, locaisSemSaldo = [], custoSuspeito, podeAtualizar }: {
  atualizadoEm: string | null; locaisSemLeitura: string[]; locaisSemSaldo?: string[]; custoSuspeito: number; podeAtualizar: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [ultimoClique, setUltimoClique] = useState(0)

  function atualizar() {
    if (Date.now() - ultimoClique < 60_000) return // evita duplo clique; a trava de verdade é no servidor
    setUltimoClique(Date.now())
    start(async () => {
      const r = await fetch('/api/sync/posicao', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.status === 429) { toast.info(j.error ?? 'Atualizado há pouco. Tente de novo em alguns minutos.'); return }
      if (!r.ok) { toast.error('Não foi possível atualizar do Omie', { description: j.error ?? `HTTP ${r.status}` }); return }
      toast.success('Estoque atualizado do Omie')
      router.refresh()
    })
  }

  return (
    <div className="rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] text-text-muted">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Espelho do Omie · {atualizadoEm ? `atualizado em ${quando(atualizadoEm)}` : 'ainda sem leitura'}</span>
        {podeAtualizar && (
          <button type="button" onClick={atualizar} disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 font-medium text-text u-card disabled:opacity-60">
            <RefreshCw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} /> {pending ? 'Atualizando…' : 'Atualizar do Omie'}
          </button>
        )}
      </div>
      {locaisSemLeitura.length > 0 && <p className="mt-1 text-warn">Não atualizou na última leitura: {locaisSemLeitura.join(', ')}. O saldo desses locais aparece zerado até a próxima leitura.</p>}
      {locaisSemSaldo.length > 0 && <p className="mt-1">Sem saldo no Omie ou ainda não lidos: {locaisSemSaldo.join(', ')}.</p>}
      {custoSuspeito > 0 && <p className="mt-1 text-warn">{custoSuspeito} produto{custoSuspeito === 1 ? '' : 's'} com custo médio fora do normal no Omie (não entram no valor do estoque).</p>}
    </div>
  )
}
