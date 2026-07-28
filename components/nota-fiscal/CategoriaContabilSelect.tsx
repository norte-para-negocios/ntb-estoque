'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { setCategoriaContabilNFItem } from '@/lib/actions/nota-fiscal'

type Categoria = { id: number; nome: string }

export function CategoriaContabilSelect({
  itemId,
  valorInicial,
  categorias,
}: {
  itemId: number
  valorInicial: number | null
  categorias: Categoria[]
}) {
  const [valor, setValor] = useState(valorInicial != null ? String(valorInicial) : '')
  const [pending, startTransition] = useTransition()

  function salvar(v: string) {
    const anterior = valor
    setValor(v) // otimista
    const categoriaId = v ? Number(v) : null
    startTransition(async () => {
      const res = await setCategoriaContabilNFItem(itemId, categoriaId)
      if (res?.error) {
        toast.error('Erro ao salvar categoria', { description: res.error })
        setValor(anterior) // desfaz o otimismo
      } else {
        toast.success('Categoria salva')
      }
    })
  }

  return (
    <select
      value={valor}
      onChange={(e) => salvar(e.target.value)}
      disabled={pending}
      className="h-9 w-full max-w-[200px] rounded-md border border-border bg-surface px-2 text-[13px] text-text outline-none transition-colors focus:border-brand disabled:opacity-60"
    >
      <option value="">Sem categoria</option>
      {categorias.map((c) => (
        <option key={c.id} value={String(c.id)}>{c.nome}</option>
      ))}
    </select>
  )
}
