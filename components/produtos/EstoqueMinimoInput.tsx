'use client'

import { useRef, useState, useTransition } from 'react'
import { setEstoqueMinimo } from '@/lib/actions/produto-minimo'
import { toast } from 'sonner'

export function EstoqueMinimoInput({
  produtoId,
  valorManual,
  valorOmie,
}: {
  produtoId: number
  valorManual: number | null // override definido no NTB (produtos.estoque_minimo)
  valorOmie: number | null // minimo vindo do Omie (posicao de estoque)
}) {
  // Mostra o valor EFETIVO preenchido: override manual tem prioridade; senao o do Omie.
  const efetivo = valorManual != null ? valorManual : valorOmie
  const inicial = efetivo != null ? String(efetivo) : ''
  const [valor, setValor] = useState(inicial)
  const salvoRef = useRef(inicial)
  const [pending, startTransition] = useTransition()

  function salvar() {
    const atual = valor.trim()
    if (atual === salvoRef.current) return // nao mudou: nao grava override redundante
    const num = atual === '' ? null : Number(atual)
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Valor inválido')
      setValor(salvoRef.current)
      return
    }
    salvoRef.current = atual
    startTransition(async () => {
      const res = await setEstoqueMinimo(produtoId, num)
      if (res?.error) toast.error('Erro', { description: res.error })
      else toast.success('Mínimo salvo')
    })
  }

  const ehManual = valorManual != null
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      value={valor}
      disabled={pending}
      onChange={(e) => setValor(e.target.value)}
      onBlur={salvar}
      placeholder="0"
      title={ehManual ? 'Mínimo definido manualmente no NTB' : 'Mínimo vindo do Omie. Edite para sobrescrever.'}
      className={`num w-16 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-brand disabled:opacity-60 ${
        ehManual ? 'font-semibold text-brand' : 'text-text'
      }`}
    />
  )
}
