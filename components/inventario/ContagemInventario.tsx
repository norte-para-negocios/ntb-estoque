'use client'

import { useMemo, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation' // ainda usado no finalizar
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { Trash2, CheckCircle, Minus, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { buscarProdutoPorCodigo, type ProdutoBusca } from '@/lib/actions/produtos-search'
import { parseNumBR } from '@/lib/num-br'

const QrScanner = dynamic(
  () => import('@/components/contagem/QrScanner').then((m) => m.QrScanner),
  { ssr: false }
)
import {
  addInventarioItem,
  editQuantidadeInventarioItem,
  removeInventarioItem,
  finishInventario,
  forceSyncInventario,
} from '@/lib/actions/inventario'

export type ItemContagem = {
  id: number
  produto_codigo: string
  produto_descricao: string
  produto_familia: string | null
  unidade?: string | null
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
      const novo = await addInventarioItem(inventarioId, {
        produto_codigo_produto: p.codigo_produto,
        produto_codigo: p.codigo,
        produto_descricao: p.descricao,
        produto_familia: p.descricao_familia,
      })
      if (novo) {
        setItens((prev) => [
          {
            ...novo,
            produto_familia: novo.produto_familia ?? p.descricao_familia,
            unidade: p.unidade ?? null,
          } as ItemContagem,
          ...prev,
        ])
      }
      toast.success('Produto adicionado')
    })
  }

  function onLeituraQr(codigo: string) {
    startTransition(async () => {
      const p = await buscarProdutoPorCodigo(codigo)
      if (!p) {
        toast.warning('Produto não encontrado', { description: `Código: ${codigo}` })
        return
      }
      adicionar(p)
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

  function reenviar() {
    startTransition(async () => {
      const res = await forceSyncInventario(inventarioId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Reenviado ao Omie')
        router.refresh()
      }
    })
  }

  // Resumo de integracao apos finalizar: quantos itens entraram no Omie.
  const total = itens.length
  const integrados = itens.filter((i) => i.status === 'Concluido').length
  const comErro = itens.filter((i) => i.status === 'Erro' || i.status === 'Sem CMC').length

  return (
    <div className="pb-28 lg:pb-20">
      {finalizado && total > 0 && (
        <div
          className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
            comErro ? 'border-err/40 bg-err/5' : 'border-ok/40 bg-ok/5'
          }`}
        >
          <span className="text-sm font-medium text-text">
            <span className="num">{integrados}</span> de <span className="num">{total}</span> produtos integrados ao Omie
            {comErro > 0 && <span className="text-err"> · {comErro} com erro</span>}
          </span>
          {comErro > 0 && (
            <button onClick={reenviar} disabled={pending} className={btnClass('outline')}>
              {pending ? 'Reenviando...' : 'Reenviar pendentes'}
            </button>
          )}
        </div>
      )}

      {!finalizado && (
        <div className="sticky top-0 z-10 -mx-4 mb-4 space-y-2 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
          <ProdutoSearch
            onSelect={adicionar}
            codigosAdicionados={itens.map((i) => i.produto_codigo)}
          />
          <QrScanner onLeitura={onLeituraQr} />
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
            // base finita para os botoes +/- (evita NaN propagando)
            const base = Number.isFinite(q as number) ? (q as number) : 0
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
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-err disabled:opacity-50"
                      aria-label="Remover"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="eyebrow">Quantidade{item.unidade ? ` (${item.unidade})` : ''}</span>
                  {finalizado ? (
                    <span className="num text-lg font-semibold text-text">{q ?? 0}</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => salvarQtd(item.id, Math.max(0, base - 1))}
                        disabled={pending}
                        className="flex size-11 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
                        aria-label="Diminuir"
                      >
                        <Minus className="size-4" />
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={q ?? ''}
                        disabled={pending}
                        onChange={(e) => {
                          const parsed = parseNumBR(e.target.value)
                          const val = parsed != null && Number.isFinite(parsed) ? parsed : null
                          setItens((prev) =>
                            prev.map((i) => (i.id === item.id ? { ...i, quan: val } : i))
                          )
                        }}
                        onBlur={(e) => {
                          const parsed = parseNumBR(e.target.value)
                          const val = parsed != null && Number.isFinite(parsed) ? parsed : null
                          salvarQtd(item.id, val)
                        }}
                        onWheel={(e) => e.currentTarget.blur()}
                        className="num h-11 w-16 rounded-md border border-border bg-surface px-2 text-center text-lg font-semibold text-text outline-none focus:border-brand"
                        placeholder="0"
                      />
                      <button
                        onClick={() => salvarQtd(item.id, base + 1)}
                        disabled={pending}
                        className="flex size-11 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
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
