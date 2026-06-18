'use client'

import { useMemo, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation' // ainda usado no finalizar
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { Trash2, CheckCircle, Minus, Plus, Search, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { buscarProdutoPorCodigo, type ProdutoBusca } from '@/lib/actions/produtos-search'
import { parseNumBR } from '@/lib/num-br'

const QrScanner = dynamic(
  () => import('@/components/contagem/QrScanner').then((m) => m.QrScanner),
  { ssr: false }
)
import {
  addInventarioItem,
  enviarInventarioItem,
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
  const [buscaManual, setBuscaManual] = useState(false)
  // Inventario finalizado entra em modo leitura; "Editar itens" destrava os
  // controles para corrigir/excluir um item depois de finalizado (o servidor
  // exclui o ajuste antigo no Omie e relanca a nova quantidade).
  const [editando, setEditando] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  // Controles de quantidade/remocao liberados: durante a contagem (nao finalizado)
  // ou quando o usuario clica em "Editar itens" num inventario finalizado.
  const editavel = !finalizado || editando

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

  async function onLeituraQr(codigo: string): Promise<boolean> {
    const p = await buscarProdutoPorCodigo(codigo)
    if (!p) {
      toast.warning('Produto não encontrado', { description: `Código: ${codigo}` })
      return false
    }
    adicionar(p)
    return true
  }

  // Sai do campo de quantidade -> envia o item ao Omie na hora (item-a-item). Se o
  // item ja tinha sido lancado, o servidor exclui o ajuste antigo e relanca
  // (reprocessa ao mexer na quantidade). Erro num item nao trava os outros.
  function salvarQtd(itemId: number, num: number | null) {
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade inválida')
      return
    }
    setItens((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? { ...i, quan: num, status: num != null ? 'Processando' : 'Iniciado' }
          : i
      )
    )
    startTransition(async () => {
      const res = await enviarInventarioItem(itemId, num)
      setItens((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, status: res.status } : i))
      )
      if (res.status === 'Erro' || res.status === 'Sem CMC') {
        toast.error('Falha ao integrar item', {
          description: res.descricao_status || (res.status === 'Sem CMC' ? 'Produto sem CMC' : 'Tente reenviar'),
        })
      } else if (res.status === 'Concluido') {
        toast.success('Item integrado ao Omie')
      }
    })
  }

  function remover(itemId: number) {
    if (finalizado && !window.confirm('Excluir este item? O ajuste já lançado no Omie será removido.')) {
      return
    }
    const anterior = itens
    setItens((prev) => prev.filter((i) => i.id !== itemId))
    startTransition(async () => {
      const res = await removeInventarioItem(itemId)
      if (res?.error) {
        setItens(anterior) // desfaz o otimismo se o Omie recusar
        toast.error('Erro ao remover', { description: res.error })
      } else {
        toast.success('Item removido')
      }
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

  // Resumo de integracao: como cada item ja integra na hora, mostramos o placar
  // durante a contagem tambem (e o botao de reenviar pendentes quando ha erro).
  const total = itens.length
  const integrados = itens.filter((i) => i.status === 'Concluido').length
  const comErro = itens.filter((i) => i.status === 'Erro' || i.status === 'Sem CMC').length

  return (
    <div className="pb-28 lg:pb-20">
      {total > 0 && (integrados > 0 || comErro > 0 || finalizado) && (
        <div
          className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
            comErro ? 'border-err/40 bg-err/5' : 'border-ok/40 bg-ok/5'
          }`}
        >
          <span className="text-sm font-medium text-text">
            <span className="num">{integrados}</span> de <span className="num">{total}</span> produtos integrados ao Omie
            {comErro > 0 && <span className="text-err"> · {comErro} com erro</span>}
          </span>
          <span className="inline-flex items-center gap-2">
            {comErro > 0 && (
              <button onClick={reenviar} disabled={pending} className={btnClass('outline')}>
                {pending && <Spinner />}
                {pending ? 'Reenviando...' : 'Reenviar pendentes'}
              </button>
            )}
            {finalizado && (
              <button
                onClick={() => setEditando((v) => !v)}
                disabled={pending}
                className={btnClass(editando ? 'primary' : 'outline')}
              >
                {editando ? (
                  <>
                    <X className="size-4" /> Concluir edição
                  </>
                ) : (
                  <>
                    <Pencil className="size-4" /> Editar itens
                  </>
                )}
              </button>
            )}
          </span>
        </div>
      )}

      {editando && (
        <p className="mb-4 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-text-muted">
          Editando um inventário finalizado. Ao alterar a quantidade ou excluir um item, o ajuste já
          lançado no Omie é refeito ou removido na hora.
        </p>
      )}

      {!finalizado && (
        <div className="sticky top-0 z-10 -mx-4 mb-4 space-y-2 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
          <QrScanner onLeitura={onLeituraQr} />
          {buscaManual ? (
            <ProdutoSearch
              onSelect={adicionar}
              codigosAdicionados={itens.map((i) => i.produto_codigo)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setBuscaManual(true)}
              className="w-full py-1 text-center text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
            >
              buscar manualmente
            </button>
          )}
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
        <ul className="space-y-2 lg:space-y-1.5">
          {visiveis.map((item) => {
            const q = item.quan
            // base finita para os botoes +/- (evita NaN propagando)
            const base = Number.isFinite(q as number) ? (q as number) : 0
            return (
              <li
                key={item.id}
                className="rounded-lg border border-border bg-surface p-3.5 lg:flex lg:items-center lg:gap-3 lg:py-2 lg:pl-3.5 lg:pr-2"
              >
                <div className="flex items-start justify-between gap-3 lg:min-w-0 lg:flex-1 lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text">{item.produto_descricao}</span>
                      {item.status && (
                        <span className="hidden shrink-0 lg:inline">
                          <StatusPill status={item.status} />
                        </span>
                      )}
                    </div>
                    <div className="num mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                      <span>{item.produto_codigo}</span>
                      {item.produto_familia && (
                        <span className="hidden truncate text-[11px] text-text-muted lg:inline">{item.produto_familia}</span>
                      )}
                    </div>
                    {item.produto_familia && (
                      <div className="mt-1 text-[11px] text-text-muted lg:hidden">{item.produto_familia}</div>
                    )}
                    {item.status && (
                      <div className="mt-1.5 lg:hidden">
                        <StatusPill status={item.status} />
                      </div>
                    )}
                  </div>
                  {editavel && (
                    <button
                      onClick={() => remover(item.id)}
                      disabled={pending}
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-err disabled:opacity-50 lg:order-last lg:size-8"
                      aria-label="Remover"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 lg:mt-0 lg:shrink-0 lg:justify-end">
                  <span className="eyebrow lg:hidden">Quantidade{item.unidade ? ` (${item.unidade})` : ''}</span>
                  <span className="hidden text-xs text-text-muted lg:inline">{item.unidade || ''}</span>
                  {!editavel ? (
                    <span className="num text-lg font-semibold text-text lg:text-base">{q ?? 0}</span>
                  ) : (
                    <div className="flex items-center gap-2 lg:gap-1.5">
                      <button
                        onClick={() => salvarQtd(item.id, Math.max(0, base - 1))}
                        disabled={pending}
                        className="flex size-11 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 disabled:opacity-50 lg:size-8"
                        aria-label="Diminuir"
                      >
                        <Minus className="size-4 lg:size-3.5" />
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
                        className="num h-12 w-20 rounded-md border border-border bg-surface px-2 text-center text-2xl font-semibold text-text outline-none focus:border-brand lg:h-8 lg:w-16 lg:text-base"
                        placeholder="0"
                      />
                      <button
                        onClick={() => salvarQtd(item.id, base + 1)}
                        disabled={pending}
                        className="flex size-11 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 disabled:opacity-50 lg:size-8"
                        aria-label="Aumentar"
                      >
                        <Plus className="size-4 lg:size-3.5" />
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
              {pending ? <Spinner /> : <CheckCircle className="size-4" />}
              {pending ? 'Processando...' : 'Concluir inventário'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
