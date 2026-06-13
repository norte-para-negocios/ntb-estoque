'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { Trash2, CheckCircle, Minus, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import type { ProdutoBusca } from '@/lib/actions/produtos-search'
import {
  addInventarioItem,
  editQuantidadeInventarioItem,
  removeInventarioItem,
  finishInventario,
} from '@/lib/actions/inventario'

export type ItemContagem = {
  id: number
  produto_codigo: string
  produto_descricao: string
  produto_familia: string | null
  quan: number | null
  status: string | null
}

export function ContagemInventario({
  inventarioId,
  itensIniciais,
  finalizado,
}: {
  inventarioId: number
  itensIniciais: ItemContagem[]
  finalizado: boolean
}) {
  const [itens, setItens] = useState(itensIniciais)
  const [filtro, setFiltro] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const visiveis = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return itens
    return itens.filter(
      (i) =>
        i.produto_descricao.toLowerCase().includes(q) ||
        i.produto_codigo.toLowerCase().includes(q) ||
        (i.produto_familia ?? '').toLowerCase().includes(q)
    )
  }, [itens, filtro])

  function adicionar(p: ProdutoBusca) {
    if (itens.some((i) => i.produto_codigo === p.codigo)) {
      toast.info('Produto já está na contagem')
      return
    }
    startTransition(async () => {
      await addInventarioItem(inventarioId, {
        produto_codigo_produto: p.codigo_produto,
        produto_codigo: p.codigo,
        produto_descricao: p.descricao,
        produto_familia: p.descricao_familia,
      })
      router.refresh()
      toast.success('Produto adicionado')
    })
  }

  function salvarQtd(itemId: number, num: number | null) {
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade inválida')
      return
    }
    setItens((prev) => prev.map((i) => (i.id === itemId ? { ...i, quan: num } : i)))
    startTransition(() => {
      editQuantidadeInventarioItem(itemId, num)
    })
  }

  function remover(itemId: number) {
    setItens((prev) => prev.filter((i) => i.id !== itemId))
    startTransition(async () => {
      await removeInventarioItem(itemId)
      toast.success('Item removido')
    })
  }

  function finalizar() {
    startTransition(async () => {
      const res = await finishInventario(inventarioId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Inventário enviado ao Omie')
        router.refresh()
      }
    })
  }

  return (
    <div className="pb-28 lg:pb-20">
      {!finalizado && (
        <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
          <ProdutoSearch onSelect={adicionar} />
        </div>
      )}

      {itens.length > 0 && (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar itens da lista"
            className="w-full rounded-md border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand"
          />
        </div>
      )}

      {visiveis.length ? (
        <ul className="space-y-2.5">
          {visiveis.map((item) => {
            const q = item.quan
            return (
              <li
                key={item.id}
                className="rounded-lg border border-border bg-surface p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text">{item.produto_descricao}</div>
                    <div className="num mt-0.5 text-xs text-text-muted">{item.produto_codigo}</div>
                    {item.produto_familia && (
                      <div className="mt-1 text-[11px] text-text-muted">{item.produto_familia}</div>
                    )}
                    {item.status && (
                      <div className="mt-1 text-[11px] text-text-muted">{item.status}</div>
                    )}
                  </div>
                  {!finalizado && (
                    <button
                      onClick={() => remover(item.id)}
                      disabled={pending}
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-[var(--err)] disabled:opacity-50"
                      aria-label="Remover"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="eyebrow">Quantidade</span>
                  {finalizado ? (
                    <span className="num text-lg font-semibold text-text">{q ?? 0}</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => salvarQtd(item.id, Math.max(0, (q ?? 0) - 1))}
                        disabled={pending}
                        className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
                        aria-label="Diminuir"
                      >
                        <Minus className="size-4" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={q ?? ''}
                        disabled={pending}
                        onChange={(e) =>
                          setItens((prev) =>
                            prev.map((i) =>
                              i.id === item.id
                                ? { ...i, quan: e.target.value === '' ? null : Number(e.target.value) }
                                : i
                            )
                          )
                        }
                        onBlur={(e) =>
                          salvarQtd(item.id, e.target.value === '' ? null : Number(e.target.value))
                        }
                        className="num w-16 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-lg font-semibold text-text outline-none focus:border-brand"
                        placeholder="0"
                      />
                      <button
                        onClick={() => salvarQtd(item.id, (q ?? 0) + 1)}
                        disabled={pending}
                        className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
                        aria-label="Aumentar"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Search}
          title={filtro ? 'Nenhum item encontrado' : 'Nenhum item'}
          hint={filtro ? 'Ajuste o filtro de busca.' : 'Use a busca acima para adicionar produtos.'}
        />
      )}

      {!finalizado && itens.length > 0 && (
        <div className="sticky bottom-16 z-20 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0">
          <div className="flex justify-end">
            <button
              onClick={finalizar}
              disabled={pending}
              className={`${btnClass('primary')} w-full sm:w-auto`}
            >
              <CheckCircle className="size-4" />
              {pending ? 'Enviando ao Omie...' : 'Finalizar e enviar ao Omie'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
