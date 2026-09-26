'use client'

import { useState } from 'react'
import { Printer, ChevronDown, ChevronUp } from 'lucide-react'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Num } from '@/components/ui-kit/Num'
import { btnClass } from '@/components/ui-kit/Button'
import { QuantidadeInput } from '@/components/nota-fiscal/QuantidadeInput'
import { CategoriaContabilSelect } from '@/components/nota-fiscal/CategoriaContabilSelect'
import { DialogImprimirEtiqueta } from '@/components/etiqueta/DialogImprimirEtiqueta'
import { FileText } from 'lucide-react'
import { impostosItem } from '@/lib/nf-impostos-item'

export type ItemNF = {
  id: number
  c_codigo_produto: string | null
  c_descricao_produto: string | null
  c_cfop: string | null
  n_qtde_nfe: number | null
  c_unidade_nfe: string | null
  n_preco_unit: number | null
  v_total_item: number | null
  quantidade: number | null
  categoria_contabil_id: number | null
  full_object?: unknown
}

export function ItensNotaFiscal({
  notaId,
  itens,
  categorias,
}: {
  notaId: string
  itens: ItemNF[]
  categorias: { id: number; nome: string }[]
}) {
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [expandido, setExpandido] = useState<Set<number>>(new Set())

  function toggleExpandido(id: number) {
    setExpandido((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

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

  if (!itens.length) {
    return <EmptyState icon={FileText} title="Nenhum item nesta nota" />
  }

  const base = `/nota-fiscal/${notaId}/imprimir`
  const todosMarcados = sel.size === itens.length && itens.length > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <DialogImprimirEtiqueta
          href={sel.size ? `${base}?itens=${[...sel].join(',')}` : base}
          trigger={
            <button type="button" disabled={sel.size === 0} className={`${btnClass('outline')} disabled:opacity-50`}>
              <Printer className="size-4" /> Imprimir selecionados{sel.size ? ` (${sel.size})` : ''}
            </button>
          }
        />
        <DialogImprimirEtiqueta
          href={base}
          trigger={
            <button type="button" className={btnClass('primary')}>
              <Printer className="size-4" /> Imprimir todos
            </button>
          }
        />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden lg:block">
        {/* Mesmo visual do DataTable do kit, mas com layout automático + rolagem
            horizontal: com 11 colunas o table-fixed espremia o nome do produto
            em ~5 letras. Aqui o produto quebra linha e nada é cortado. */}
        <div className="u-stagger overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
        <table className="w-full min-w-[960px] text-sm [&_td:last-child]:sticky [&_td:last-child]:right-0 [&_td:last-child]:bg-surface [&_th:last-child]:sticky [&_th:last-child]:right-0 [&_th:last-child]:bg-surface [&_th]:whitespace-nowrap [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[13px] [&_th]:font-semibold [&_th]:text-text-muted [&_thead]:border-b [&_thead]:border-border [&_td]:px-4 [&_td]:py-2.5 [&_tbody_tr]:border-b [&_tbody_tr]:border-border/60 [&_tbody_tr:last-child]:border-0 [&_tbody_tr]:u-motion hover:[&_tbody_tr]:bg-surface-2/60">
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
              <th className="min-w-[240px]">Produto</th>
              <th>CFOP</th>
              <th className="!text-right">Qtd NFe</th>
              <th className="!text-right">Preço unit.</th>
              <th className="!text-right">Total</th>
              <th className="!text-right">Qtd p/ etiqueta</th>
              <th>Categoria contábil</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => {
              const impostos = impostosItem(item.full_object)
              return (
                <>
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
                    <td className="font-medium text-text">{item.c_descricao_produto}</td>
                    <td className="num text-text-muted">{item.c_cfop || '-'}</td>
                    <td className="whitespace-nowrap text-right">
                      <Num value={item.n_qtde_nfe} frac={3} />{' '}
                      <span className="text-text-muted">{item.c_unidade_nfe}</span>
                    </td>
                    <td className="num whitespace-nowrap text-right text-text-muted">
                      {item.n_preco_unit != null ? Number(item.n_preco_unit).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}
                    </td>
                    <td className="num whitespace-nowrap text-right font-medium">
                      {item.v_total_item != null ? Number(item.v_total_item).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end">
                        <QuantidadeInput itemId={item.id} valorInicial={item.quantidade} />
                      </div>
                    </td>
                    <td>
                      <CategoriaContabilSelect itemId={item.id} valorInicial={item.categoria_contabil_id} categorias={categorias} />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {impostos.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleExpandido(item.id)}
                          className="inline-flex items-center gap-0.5 text-[13px] font-medium text-brand hover:underline"
                        >
                          Impostos {expandido.has(item.id) ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        </button>
                      )}
                    </td>
                    <td className="text-right">
                      <DialogImprimirEtiqueta
                        href={`${base}?itens=${item.id}`}
                        trigger={
                          <button type="button" className="whitespace-nowrap font-semibold text-brand hover:underline">
                            Imprimir
                          </button>
                        }
                      />
                    </td>
                  </tr>
                  {expandido.has(item.id) && impostos.length > 0 && (
                    <tr key={`${item.id}-impostos`}>
                      <td></td>
                      <td colSpan={9} className="bg-surface-2/50 py-2">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                          {impostos.map((imp) => (
                            <span key={imp.label} className="text-text-muted">
                              {imp.label}:{' '}
                              <span className="num font-medium text-text">
                                {imp.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              </span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        <label className="flex min-h-[44px] items-center gap-2 px-1 text-[15px] text-text-muted">
          <input
            type="checkbox"
            checked={todosMarcados}
            onChange={toggleTodos}
            aria-label="Selecionar todos"
            className="size-4 accent-[var(--brand)]"
          />
          Selecionar todos
        </label>
        {itens.map((item) => {
          const impostos = impostosItem(item.full_object)
          return (
          <div
            key={item.id}
            className={`rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] p-4 ${
              sel.has(item.id) ? 'bg-brand-soft/40' : 'bg-surface'
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
                <div className="num text-[13px] text-text-muted">{item.c_codigo_produto}</div>
                <div className="text-[15px] font-semibold text-text break-words">{item.c_descricao_produto}</div>
              </div>
            </div>

            <div className="mt-3 text-sm">
              <span className="text-[13px] font-semibold text-text-muted">
                Qtd NFe{' '}
              </span>
              <Num value={item.n_qtde_nfe} frac={3} />{' '}
              <span className="text-text-muted">{item.c_unidade_nfe}</span>
            </div>

            {impostos.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => toggleExpandido(item.id)}
                  className="inline-flex min-h-[44px] items-center gap-0.5 text-[13px] font-medium text-brand hover:underline"
                >
                  Impostos {expandido.has(item.id) ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
                {expandido.has(item.id) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
                    {impostos.map((imp) => (
                      <span key={imp.label} className="text-text-muted">
                        {imp.label}:{' '}
                        <span className="num font-medium text-text">
                          {imp.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-3">
              <div className="mb-1 text-[13px] font-semibold text-text-muted">
                Qtd p/ etiqueta
              </div>
              <QuantidadeInput itemId={item.id} valorInicial={item.quantidade} />
            </div>

            <div className="mt-3">
              <div className="mb-1 text-[13px] font-semibold text-text-muted">
                Categoria contábil
              </div>
              <CategoriaContabilSelect itemId={item.id} valorInicial={item.categoria_contabil_id} categorias={categorias} />
            </div>

            <div className="mt-4 border-t border-border/60 pt-3">
              <DialogImprimirEtiqueta
                href={`${base}?itens=${item.id}`}
                trigger={
                  <button type="button" className="inline-flex min-h-[44px] items-center gap-1.5 font-semibold text-brand hover:underline">
                    <Printer className="size-3.5" /> Imprimir
                  </button>
                }
              />
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
