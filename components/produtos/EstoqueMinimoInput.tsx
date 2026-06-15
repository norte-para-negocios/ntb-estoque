'use client'

import { useState, useTransition } from 'react'
import { setEstoqueMinimo } from '@/lib/actions/produto-minimo'
import { toast } from 'sonner'

export function EstoqueMinimoInput({
  produtoId,
  valorInicial,
  valorOmie,
}: {
  produtoId: number
  valorInicial: number | null
  // Minimo vindo do Omie (ListarPosEstoque). Vira o placeholder: se o usuario
  // nao definir override manual, este e o valor que vale para o calculo.
  valorOmie: number | null
}) {
  const [valor, setValor] = useState(valorInicial != null ? String(valorInicial) : '')
  const [pending, startTransition] = useTransition()

  function salvar() {
    const num = valor.trim() === '' ? null : Number(valor)
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Valor inválido')
      return
    }
    startTransition(async () => {
      const res = await setEstoqueMinimo(produtoId, num)
      if (res?.error) toast.error('Erro', { description: res.error })
    })
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      value={valor}
      disabled={pending}
      onChange={(e) => setValor(e.target.value)}
      onBlur={salvar}
      placeholder={valorOmie != null ? String(valorOmie) : '0'}
      title={valorOmie != null ? `Mínimo do Omie: ${valorOmie}. Digite para sobrescrever.` : 'Defina o mínimo'}
      className="num w-16 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm text-text outline-none focus:border-brand disabled:opacity-60 placeholder:text-text-muted/60"
    />
  )
}
