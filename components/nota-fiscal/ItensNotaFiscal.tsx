'use client'

import { useState } from 'react'
import { Printer } from 'lucide-react'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Num } from '@/components/ui-kit/Num'
import { btnClass } from '@/components/ui-kit/Button'
import { QuantidadeInput } from '@/components/nota-fiscal/QuantidadeInput'
import { FileText } from 'lucide-react'

export type ItemNF = {
  id: number
  c_codigo_produto: string | null
  c_descricao_produto: string | null
  n_qtde_nfe: number | null
  c_unidade_nfe: string | null
  quantidade: number | null
}

export function ItensNotaFiscal({ notaId, itens }: { notaId: string; itens: ItemNF[] }) {
  const [sel, setSel] = useState<Set<number>>(new Set())

  function toggle(id: number) {
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function toggleTodos() {
    setSel((s) => (s.size === itens.length ? new Set() : new Set(itens.map((i) => i.id))))
  }

  function imprimir(ids?: number[]) {
    const base = `/nota-fiscal/${notaId}/imprimir`
    const url = ids && ids.length ? `${base}?itens=${ids.join(',')}` : base
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  if (!itens.length) {
    return <EmptyState icon={FileText} title="Nenhum item nesta nota" />
  }

  const todosMarcados = sel.size === itens.length && itens.length > 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => imprimir([...sel])}
          disabled={sel.size === 0}
          className={`${btnClass('outline')} disabled:opacity-50`}
        >
          <Printer className="size-4" /> Imprimir selecionados{sel.size ? ` (${sel.size})` : ''}
        </button>
        <button type="button" onClick={() => imprimir()} className={btnClass('primary')}>
          <Printer className="size-4" /> Imprimir todos
        </button>
      </div>

      {/* Desktop: tabela */}
      <div className="hidden lg:block">
        <DataTable>
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={todosMarcados}
                  onChange={toggleTodos}
                  aria-label="Selecionar todos"
                  className="size-4 accent-[var(--brand)]"
                />
              </th>
              <th>Código</th>
              <th>Produto</th>
              <th className="text-right">Qtd NFe</th>
              <th className="text-right">Qtd p/ etiqueta</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr key={item.id} className={sel.has(item.id) ? 'bg-brand-soft/40' : ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={sel.has(item.id)}
                    onChange={() => toggle(item.id)}
                    aria-label={`Selecionar ${item.c_codigo_produto}`}
                    className="size-4 accent-[var(--brand)]"
                  />
                </td>
                <td className="num text-text-muted">{item.c_codigo_produto}</td>
                <td className="max-w-md truncate">{item.c_descricao_produto}</td>
                <td className="text-right">
                  <Num value={item.n_qtde_nfe} frac={3} />{' '}
                  <span className="text-text-muted">{item.c_unidade_nfe}</span>
                </td>
                <td className="text-right">
                  <div className="flex justify-end">
                    <QuantidadeInput itemId={item.id} valorInicial={item.quantidade} />
                  </div>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => imprimir([item.id])}
                    className="text-brand hover:underline whitespace-nowrap"
                  >
                    Imprimir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        <label className="flex items-center gap-2 px-1 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={todosMarcados}
            onChange={toggleTodos}
            aria-label="Selecionar todos"
            className="size-4 accent-[var(--brand)]"
          />
          Selecionar todos
        </label>
        {itens.map((item) => (
          <div
            key={item.id}
            className={`rounded-lg border border-border bg-surface p-4 ${
              sel.has(item.id) ? 'bg-brand-soft/40' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={sel.has(item.id)}
                onChange={() => toggle(item.id)}
                aria-label={`Selecionar ${item.c_codigo_produto}`}
                className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
              />
              <div className="min-w-0 flex-1">
                <div className="num text-[11px] text-text-muted">{item.c_codigo_produto}</div>
                <div className="font-medium text-text break-words">{item.c_descricao_produto}</div>
              </div>
            </div>

            <div className="mt-3 text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Qtd NFe{' '}
              </span>
              <Num value={item.n_qtde_nfe} frac={3} />{' '}
              <span className="text-text-muted">{item.c_unidade_nfe}</span>
            </div>

            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Qtd p/ etiqueta
              </div>
              <QuantidadeInput itemId={item.id} valorInicial={item.quantidade} />
            </div>

            <div className="mt-4 border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => imprimir([item.id])}
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                <Printer className="size-3.5" /> Imprimir
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
