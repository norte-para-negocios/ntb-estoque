'use client'

import { useMemo, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { Trash2, CheckCircle, Minus, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { buscarProdutoPorCodigo, type ProdutoBusca } from '@/lib/actions/produtos-search'
import { parseNumBR, formatNumBR } from '@/lib/num-br'

const QrScanner = dynamic(
  () => import('@/components/contagem/QrScanner').then((m) => m.QrScanner),
  { ssr: false }
)
import {
  addMovimento,
  enviarMovimento,
  removeMovimento,
  finishTransferencia,
  forceSyncTransferencia,
} from '@/lib/actions/transferencia'

// Base do stepper +/-: prioriza o que esta DIGITADO agora (texto cru, pode ter
// virgula e ainda nao ter dado blur); se invalido, cai no number ja salvo.
function stepBase(texto: string, fallback: number): number {
  const p = parseNumBR(texto)
  return p != null && Number.isFinite(p) ? p : fallback
}

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
  podeEditar = true,
}: {
  transferenciaId: number
  itensIniciais: ItemMovimento[]
  finalizado: boolean
  podeEditar?: boolean
}) {
  const [itens, setItens] = useState(itensIniciais)
  const [quans, setQuans] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(itensIniciais.map((i) => [i.id, i.quan]))
  )
  // Texto CRU do input de quantidade (string do que o usuario digitou). Mantido
  // separado do number: se o input fosse controlado pelo number, ao digitar a
  // virgula ("3,") o parse devolveria 3 e o React reescreveria o campo como "3",
  // comendo a virgula — impossivel chegar em "3,4". Guardando a string crua, a
  // virgula fica; o number so e calculado no blur (salvar) com parseNumBR.
  const [textos, setTextos] = useState<Record<number, string>>(() =>
    Object.fromEntries(itensIniciais.map((i) => [i.id, formatNumBR(i.quan)]))
  )
  const [filtro, setFiltro] = useState('')
  const [buscaManual, setBuscaManual] = useState(false)
  // id do item recem-adicionado: a linha nova ganha o flash de entrada (u-flash-in).
  const [novoId, setNovoId] = useState<number | null>(null)
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
          unidade: p.unidade ?? null, // sem isto a unidade (UN/KG) nao aparecia na transferencia
          quan: null,
          status: 'Iniciado',
        }
        setItens((prev) => [novoItem, ...prev])
        setQuans((prev) => ({ ...prev, [novo.id]: null }))
        setTextos((prev) => ({ ...prev, [novo.id]: '' }))
        setNovoId(novo.id)
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
  // (reprocessa ao mexer na quantidade). Erro num item nao afeta os outros.
  function salvarQtd(movId: number, num: number | null) {
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade inválida')
      return
    }
    // Quantidade > 0 vai pro Omie; vazio/zero NAO trava a transferencia: fica como
    // 'Vazio' (rotulo "Sem quantidade") e e descartado ao concluir (nao conta no
    // placar nem manda ajuste zero ao Omie). Antes ficava 'Iniciado' pra sempre,
    // contando no denominador e parecendo que a transferencia nunca conclui.
    const temQtd = num != null && num > 0
    setQuans((prev) => ({ ...prev, [movId]: num }))
    setTextos((prev) => ({ ...prev, [movId]: formatNumBR(num) }))
    setItens((prev) =>
      prev.map((i) =>
        i.id === movId
          ? { ...i, quan: num, status: temQtd ? 'Processando' : 'Vazio' }
          : i
      )
    )
    startTransition(async () => {
      const res = await enviarMovimento(movId, num)
      // Servidor devolve 'Iniciado' pra qtd vazia/zero; na UI mostramos 'Vazio'
      // (rotulo claro de que o item nao entra na transferencia).
      const statusUi = res.status === 'Iniciado' ? 'Vazio' : res.status
      setItens((prev) =>
        prev.map((i) => (i.id === movId ? { ...i, status: statusUi } : i))
      )
      if (res.status === 'Erro') {
        toast.error('Falha ao integrar item', { description: res.descricao_status || 'Tente reenviar' })
      } else if (res.status === 'Concluido') {
        toast.success('Item integrado ao Omie')
      }
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

  // Resumo de integracao: como cada item ja integra na hora, mostramos o placar
  // durante a contagem tambem (e o botao de reenviar pendentes quando ha erro).
  // Itens VAZIOS (sem quantidade) NAO entram no placar: nao vao pro Omie e sao
  // descartados ao concluir, entao nao podem inflar o denominador (era o que
  // fazia a transferencia parecer "presa" sem nunca chegar a X de X).
  const vazios = itens.filter((i) => i.status === 'Vazio' || (i.quan == null || i.quan <= 0)).length
  const comQtd = itens.filter((i) => !(i.status === 'Vazio' || (i.quan == null || i.quan <= 0)))
  const total = comQtd.length
  const integrados = comQtd.filter((i) => i.status === 'Concluido').length
  const comErro = comQtd.filter((i) => i.status === 'Erro' || i.status === 'Sem CMC').length

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
            {vazios > 0 && <span className="text-text-muted"> · {vazios} sem quantidade (ignorado{vazios > 1 ? 's' : ''})</span>}
          </span>
          {comErro > 0 && (
            <button onClick={reenviar} disabled={pending} className={btnClass('outline')}>
              {pending && <Spinner />}
              {pending ? 'Reenviando...' : 'Reenviar pendentes'}
            </button>
          )}
        </div>
      )}

      {podeEditar && !finalizado && (
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
        <ul className="space-y-2 lg:space-y-1.5">
          {visiveis.map((item) => {
            const q = quans[item.id]
            const texto = textos[item.id] ?? ''
            // base finita para os botoes +/- (evita NaN propagando)
            const base = Number.isFinite(q as number) ? (q as number) : 0
            return (
              <li
                key={item.id}
                className={`rounded-lg border border-border bg-surface p-3.5 lg:flex lg:items-center lg:gap-3 lg:py-2 lg:pl-3.5 lg:pr-2${
                  item.id === novoId ? ' u-flash-in' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3 lg:min-w-0 lg:flex-1 lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text">{item.descricao}</span>
                      {item.status && (
                        <span className="hidden shrink-0 lg:inline">
                          <StatusPill status={item.status} />
                        </span>
                      )}
                    </div>
                    <div className="num mt-0.5 text-xs text-text-muted">{item.codigo}</div>
                    {item.status && (
                      <div className="mt-1.5 lg:hidden">
                        <StatusPill status={item.status} />
                      </div>
                    )}
                  </div>
                  {podeEditar && !finalizado && (
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
                  {finalizado || !podeEditar ? (
                    <span className="num text-lg font-semibold text-text lg:text-base">{formatNumBR(q ?? 0)}</span>
                  ) : (
                    <div className="flex items-center gap-2 lg:gap-1.5">
                      <button
                        onClick={() => salvarQtd(item.id, Math.max(0, stepBase(texto, base) - 1))}
                        disabled={pending}
                        className="flex size-11 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 disabled:opacity-50 lg:size-8"
                        aria-label="Diminuir"
                      >
                        <Minus className="size-4 lg:size-3.5" />
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={texto}
                        disabled={pending}
                        onChange={(e) => {
                          // Guarda a string CRUA (a virgula fica enquanto digita).
                          // So aceita digitos, virgula e ponto pra evitar lixo.
                          const limpo = e.target.value.replace(/[^\d.,]/g, '')
                          setTextos((prev) => ({ ...prev, [item.id]: limpo }))
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
                        onClick={() => salvarQtd(item.id, stepBase(texto, base) + 1)}
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

      {podeEditar && !finalizado && itens.length > 0 && (
        <div className="sticky bottom-16 z-20 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0">
          <div className="flex justify-end">
            <button
              onClick={finalizar}
              disabled={pending}
              className={`${btnClass('primary')} w-full sm:w-auto`}
            >
              {pending ? <Spinner /> : <CheckCircle className="size-4" />}
              {pending ? 'Processando...' : 'Concluir transferência'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
