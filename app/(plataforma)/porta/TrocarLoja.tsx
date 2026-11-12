'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { setCurrentLoja } from '@/lib/actions/loja-selector'

type Loja = { id: number; nome: string }

// Pílula da loja na barra da porta. Uma loja só: nome parado (não revela que existem outras).
export function TrocarLoja({ lojas, atual, nomeAtual }: { lojas: Loja[]; atual: number | null; nomeAtual: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  if (lojas.length <= 1) {
    return <div className="pn-loja"><span className="pn-so">{lojas[0]?.nome ?? nomeAtual}</span></div>
  }
  return (
    <div className="pn-loja">
      <select
        aria-label="Trocar de loja"
        value={atual != null ? String(atual) : ''}
        disabled={pending}
        onChange={(e) => {
          const id = Number(e.target.value)
          startTransition(async () => {
            const r = await setCurrentLoja(id)
            if (r?.error) toast.error('Não deu para trocar de loja', { description: r.error })
            else router.refresh()
          })
        }}
      >
        {atual == null && <option value="">Escolha a loja</option>}
        {lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
      </select>
      <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  )
}
