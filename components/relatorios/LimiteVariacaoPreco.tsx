'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { salvarLimiteVariacaoPreco } from '@/lib/actions/variacao-preco'

/** Limite (%) do alerta de variação de preço da loja (só desenvolvedor, como a tela). */
export function LimiteVariacaoPreco({ atual }: { atual: number }) {
  const [valor, setValor] = useState(String(atual).replace('.', ','))
  const [pending, start] = useTransition()
  const router = useRouter()
  function salvar(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await salvarLimiteVariacaoPreco(valor)
      if ('error' in r) { toast.error('Não foi possível salvar', { description: r.error }); return }
      toast.success('Limite salvo')
      router.refresh()
    })
  }
  return (
    <form onSubmit={salvar} className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
      <label htmlFor="limite-variacao">Avisar quando o preço mudar mais de</label>
      <input id="limite-variacao" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal"
        className="h-9 w-20 rounded-[var(--r-md)] border border-border bg-surface px-2 text-right text-sm text-text" />
      <span>%</span>
      <button type="submit" disabled={pending} className={btnClass('outline')}>{pending ? 'Salvando…' : 'Salvar'}</button>
    </form>
  )
}
