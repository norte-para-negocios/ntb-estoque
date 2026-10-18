'use client'

// Aba "Observações" da nota própria (Fase B, R17): texto livre da compra (compras_proprio.obs), com registro no histórico.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { salvarObservacaoNF } from '@/lib/actions/nota-fiscal-proprio'

export function ObservacaoNF({ notaId, obs, editavel }: { notaId: number; obs: string | null; editavel: boolean }) {
  const router = useRouter()
  const [texto, setTexto] = useState(obs ?? '')
  const [pending, start] = useTransition()
  const mudou = texto.trim() !== (obs ?? '').trim()
  if (!editavel && !obs) return null
  function salvar() {
    start(async () => {
      const r = await salvarObservacaoNF(notaId, texto)
      if ('error' in r) { toast.error('Não foi possível salvar a observação', { description: r.error }); return }
      toast.success('Observação salva'); router.refresh()
    })
  }
  return (
    <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]" aria-label="Observações">
      <h3 className="mb-2 text-[17px] font-semibold text-text">Observações</h3>
      {editavel ? (
        <div className="space-y-2">
          <textarea className="min-h-[80px] w-full rounded-[var(--r-md)] border border-[var(--border)] bg-surface px-3 py-2 text-[14px]" maxLength={2000}
            value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Anotações sobre este recebimento" aria-label="Observações da nota" />
          <div className="flex items-center justify-between text-[12px] text-text-muted">
            <span className="num">{texto.length}/2000</span>
            {mudou && <button type="button" className={btnClass('outline')} onClick={salvar} disabled={pending}>{pending && <Spinner />}Salvar observação</button>}
          </div>
        </div>
      ) : <p className="whitespace-pre-wrap text-[14px] text-text">{obs}</p>}
    </section>
  )
}
