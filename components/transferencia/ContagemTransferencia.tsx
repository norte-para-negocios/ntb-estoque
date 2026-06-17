'use client'

import { useMemo, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { Trash2, CheckCircle, Minus, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { buscarProdutoPorCodigo, type ProdutoBusca } from '@/lib/actions/produtos-search'
import { parseNumBR } from '@/lib/num-br'

const QrScanner = dynamic(
  () => import('@/components/contagem/QrScanner').then((m) => m.QrScanner),
  { ssr: false }
)
import {
  addMovimento,
  editQuantidadeMovimento,
  removeMovimento,
  finishTransferencia,
  forceSyncTransferencia,
} from '@/lib/actions/transferencia'

export type ItemMovimento = {
  id: number
  id_prod: number
  descricao: string
  codigo: string
  unidade?: string | null
  quan: number | null
  status: string | null
}

export function ContagemTransferencia({
  transferenciaId,
  itensIniciais,
  finalizado,
}: {
  transferenciaId: number
  itensIniciais: ItemMovimento[]
  finalizado: boolean
}) {
  const [itens, setItens] = useState(itensIniciais)
  const [quans, setQuans] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(itensIniciais.map((i) => [i.id, i.quan]))
  )
  const [filtro, setFiltro] = useState('')
  const [buscaManual, setBuscaManual] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const visiveis = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return itens
    return itens.filter(
      (i) => i.descricao.toLowerCase().includes(q) || i.codigo.toLowerCase().includes(q)
    )
  }, [itens, filtro])

  function adicionar(p: ProdutoBusca) {
    if (itens.some((i) => i.id_prod === p.codigo_produto)) {
      toast.info('Produto já está na transferência')
      return
    }
    startTransition(async () => {
      const novo = await addMovimento(transferenciaId, { id_prod: p.codigo_produto })
      if (novo) {
        const novoItem: ItemMovimento = {
          id: novo.id,
          id_prod: p.codigo_produto,
          descricao: p.descricao,
          codigo: p.codigo,
          quan: null,
          status: 'Iniciado',
        }
        setItens((prev) => [novoItem, ...prev])
        setQuans((prev) => ({ ...prev, [novo.id]: null }))
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

  function salvarQtd(movId: number, num: number | null) {
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade inválida')
      return
    }
    setQuans((prev) => ({ ...prev, [movId]: num }))
    startTransition(() => {
      editQuantidadeMovimento(movId, num)
    })
  }

  function remover(movId: number) {
    setItens((prev) => prev.filter((i) => i.id !== movId))
    startTransition(async () => {
      await removeMovimento(movId)
      toast.success('Item removido')
    })
  }

  function finalizar() {
    startTransition(async () => {
      const res = await finishTransferencia(transferenciaId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Transferência enviada ao Omie')
        router.refresh()
      }
    })
  }

  function reenviar() {
    startTransition(async () => {
      const res = await forceSyncTransferencia(transferenciaId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Reenviado ao Omie')
        router.refresh()
      }
    })
  }

  // Resumo de integracao apos finalizar.
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
          <QrScanner onLeitura={onLeituraQr} />
          {buscaManual ? (
            <ProdutoSearch
              onSelect={adicionar}
              codigosAdicionados={itens.map((i) => i.codigo)}
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
        <ul className="space-y-2.5">
          {visiveis.map((item) => {
            const q = quans[item.id]
            // base finita para os botoes +/- (evita NaN propagando)
            const base = Number.isFinite(q as number) ? (q as number) : 0
            return (
              <li
                key={item.id}
                className="rounded-lg border border-border bg-surface p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text">{item.descricao}</div>
                    <div className="num mt-0.5 text-xs text-text-muted">{item.codigo}</div>
                    {item.status && (
                      <div className="mt-1.5">
                        <StatusPill status={item.status} />
                      </div>
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
                          setQuans((prev) => ({ ...prev, [item.id]: val }))
                        }}
                        onBlur={(e) => {
                          const parsed = parseNumBR(e.target.value)
                          const val = parsed != null && Number.isFinite(parsed) ? parsed : null
                          salvarQtd(item.id, val)
                        }}
                        onWheel={(e) => e.currentTarget.blur()}
                        className="num h-12 w-20 rounded-md border border-border bg-surface px-2 text-center text-2xl font-semibold text-text outline-none focus:border-brand"
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
