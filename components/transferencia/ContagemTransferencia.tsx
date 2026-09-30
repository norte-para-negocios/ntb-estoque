'use client'

import { useMemo, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { Trash2, CheckCircle, Minus, Plus, Search, Pencil, X } from 'lucide-react'
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
  salvarObservacaoTransferencia,
  salvarObservacaoItem,
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
  descricao_status?: string | null
  /** Motivo/observação do item (ex.: tipo da avaria). */
  obs_item?: string | null
}

export function ContagemTransferencia({
  transferenciaId,
  itensIniciais,
  finalizado,
  podeEditar = true,
  observacaoInicial = null,
}: {
  transferenciaId: number
  itensIniciais: ItemMovimento[]
  finalizado: boolean
  podeEditar?: boolean
  observacaoInicial?: string | null
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
  // Observação geral + motivo por item (pedido do Ramon, 30/09): salvam ao sair do campo.
  const [obsGeral, setObsGeral] = useState(observacaoInicial ?? '')
  const [obsItens, setObsItens] = useState<Record<number, string>>(() =>
    Object.fromEntries(itensIniciais.map((i) => [i.id, i.obs_item ?? '']))
  )
  const [filtro, setFiltro] = useState('')
  // id do item recem-adicionado: a linha nova ganha o flash de entrada (u-flash-in).
  const [novoId, setNovoId] = useState<number | null>(null)
  // Transferencia finalizada entra em modo leitura; "Editar itens" destrava os
  // controles para corrigir/adicionar/excluir um item depois de finalizada (o
  // servidor exclui o ajuste antigo no Omie e relanca a nova quantidade).
  const [editando, setEditando] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  // Controles de quantidade/adicao/remocao liberados: durante a contagem (nao
  // finalizado) ou quando o usuario clica em "Editar itens" numa transferencia
  // finalizada. Requer tambem podeEditar (permissao Transferencias - Editar):
  // editar e por PERMISSAO, nao por status — quem pode editar, edita o concluido.
  const editavel = podeEditar && (!finalizado || editando)

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
        setObsItens((prev) => ({ ...prev, [novo.id]: '' }))
        setNovoId(novo.id)
        toast.success('Produto adicionado')
      } else {
        toast.error('Falha ao adicionar produto', { description: 'Tente novamente.' })
      }
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
      if (res.status === 'Sem CMC') {
        toast.warning('Sem custo no Omie ainda', {
          description: 'O produto ainda não tem custo médio fechado no Omie. Reenvie quando o custo aparecer.',
        })
      } else if (res.status === 'Erro') {
        toast.error('Falha ao integrar item', { description: res.descricao_status || 'Tente reenviar' })
      } else if (res.status === 'Concluido') {
        toast.success('Item integrado ao Omie')
      }
    })
  }

  function salvarObsGeral() {
    if ((observacaoInicial ?? '') === obsGeral.trim()) return
    startTransition(async () => {
      const res = await salvarObservacaoTransferencia(transferenciaId, obsGeral)
      if (res?.error) toast.error('Não foi possível salvar a observação', { description: res.error })
      else toast.success('Observação salva')
    })
  }

  function salvarObsItem(movId: number) {
    const texto = obsItens[movId] ?? ''
    const original = itens.find((i) => i.id === movId)?.obs_item ?? ''
    if (original === texto.trim()) return
    setItens((prev) => prev.map((i) => (i.id === movId ? { ...i, obs_item: texto.trim() || null } : i)))
    startTransition(async () => {
      const res = await salvarObservacaoItem(movId, texto)
      if (res?.error) {
        toast.error('Não foi possível salvar o motivo', { description: res.error })
        return
      }
      if (res?.envio) {
        const statusUi = res.envio.status === 'Iniciado' ? 'Vazio' : res.envio.status
        setItens((prev) => prev.map((i) => (i.id === movId ? { ...i, status: statusUi } : i)))
        if (res.envio.status === 'Concluido') toast.success('Motivo salvo e atualizado no Omie')
        else toast.warning('Motivo salvo; reenvio ao Omie pendente', { description: res.envio.descricao_status ?? undefined })
      } else toast.success('Motivo salvo')
    })
  }

  function remover(movId: number) {
    if (finalizado && !window.confirm('Excluir este item? O ajuste já lançado no Omie será removido.')) {
      return
    }
    const anterior = itens
    setItens((prev) => prev.filter((i) => i.id !== movId))
    startTransition(async () => {
      const res = await removeMovimento(movId)
      if (res?.error) {
        setItens(anterior) // desfaz o otimismo se o Omie recusar
        toast.error('Erro ao remover', { description: res.error })
      } else {
        toast.success('Item removido')
      }
    })
  }

  function finalizar() {
    if (itens.length === 0) {
      if (!window.confirm('Esta transferência não tem nenhum produto adicionado.\n\nConcluir agora vai deixá-la como 0/0 no histórico (sem registro de itens).\n\nDeseja continuar mesmo assim?')) return
    }
    // Avisa antes de fechar se ha item sem quantidade (sera ignorado) ou com erro
    // (nao integrou). Evita concluir sem querer deixando produto de fora.
    const semQtd = itens.filter((i) => i.status === 'Vazio' || i.quan == null || i.quan <= 0).length
    const erros = itens.filter((i) => i.status === 'Erro').length
    if (semQtd > 0 || erros > 0) {
      const partes: string[] = []
      if (semQtd > 0) partes.push(`${semQtd} item(ns) sem quantidade serão ignorados`)
      if (erros > 0) partes.push(`${erros} item(ns) com erro não foram integrados`)
      if (!window.confirm(`Concluir a transferência?\n\n${partes.join('\n')}.\n\nDeseja continuar mesmo assim?`)) return
    }
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
  // 'Erro' = falha real; 'Sem CMC' = o produto ainda nao tem custo medio fechado no
  // Omie (nao e erro nosso). Contamos separado para nao virar alerta vermelho eterno.
  const comErro = comQtd.filter((i) => i.status === 'Erro').length
  const semCusto = comQtd.filter((i) => i.status === 'Sem CMC').length
  // Cor do aviso: vermelho so com erro real; amarelo com sem-custo; verde ok.
  const tomBanner = comErro > 0 ? 'bg-err' : semCusto > 0 ? 'bg-warn' : 'bg-ok'

  return (
    <div className="pb-28 lg:pb-20">
      {total > 0 && (integrados > 0 || comErro > 0 || semCusto > 0 || finalizado) && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-lg)] bg-surface px-4 py-3 shadow-[var(--shadow-sm)]"
        >
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[15px] font-semibold text-text">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${tomBanner}`} />
              <span>
                <span className="num">{integrados}</span> de <span className="num">{total}</span> produtos integrados ao Omie
              </span>
            </span>
            {comErro > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-normal text-text-muted">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-err" />
                <span className="num">{comErro}</span> com erro
              </span>
            )}
            {semCusto > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-normal text-text-muted">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
                <span className="num">{semCusto}</span> sem custo (aguardando o Omie)
              </span>
            )}
            {vazios > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-normal text-text-muted">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-text-muted/50" />
                <span className="num">{vazios}</span> sem quantidade (ignorado{vazios > 1 ? 's' : ''})
              </span>
            )}
          </span>
          <span className="inline-flex items-center gap-2">
            {(comErro > 0 || semCusto > 0) && (
              <button onClick={reenviar} disabled={pending} className={btnClass('outline')}>
                {pending && <Spinner />}
                {pending ? 'Reenviando...' : 'Reenviar pendentes'}
              </button>
            )}
            {finalizado && podeEditar && (
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
        <p className="mb-4 flex items-start gap-2 px-1 text-[13px] text-text-muted">
          <span aria-hidden className="mt-[5px] size-2 shrink-0 rounded-full bg-warn" />
          <span>
          Editando uma transferência finalizada. Ao adicionar, alterar a quantidade ou excluir um item, o
          ajuste já lançado no Omie é refeito ou removido na hora.</span>
        </p>
      )}

      {(editavel || obsGeral.trim()) && (
        <div className="mb-4 rounded-[var(--r-lg)] bg-surface px-4 py-3 shadow-[var(--shadow-sm)]">
          <label htmlFor="obs-transferencia" className="eyebrow">Observação da transferência</label>
          {editavel ? (
            <textarea
              id="obs-transferencia"
              value={obsGeral}
              maxLength={300}
              rows={2}
              onChange={(e) => setObsGeral(e.target.value)}
              onBlur={salvarObsGeral}
              placeholder="Ex.: avarias do fim de semana, conferido pelo gerente"
              className="mt-1.5 w-full resize-y rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-[15px] text-text outline-none placeholder:text-text-muted focus:ring-2 focus:ring-brand/40 max-sm:text-base"
            />
          ) : (
            <p className="mt-1 text-[15px] text-text">{obsGeral}</p>
          )}
        </div>
      )}

      {editavel && (
        <div className="sticky top-0 z-30 -mx-4 mb-4 space-y-2 border-b border-border/60 bg-bg/85 px-4 py-3 backdrop-blur-xl sm:mx-0 sm:rounded-[var(--r-lg)] sm:border-0 sm:bg-surface/85 sm:px-3 sm:shadow-[var(--shadow-sm)]">
          {/* Busca manual ACIMA do QR (padrao em todas as contagens) */}
          <ProdutoSearch
            onSelect={adicionar}
            codigosAdicionados={itens.map((i) => i.codigo)}
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
            className="w-full rounded-[var(--r-md)] border-0 bg-surface-2 py-2.5 pl-9 pr-3 text-sm text-text outline-none max-sm:text-base transition-colors placeholder:text-text-muted focus:ring-2 focus:ring-brand/40"
          />
        </div>
      )}

      {visiveis.length ? (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
          {visiveis.map((item) => {
            const q = quans[item.id]
            const texto = textos[item.id] ?? ''
            // base finita para os botoes +/- (evita NaN propagando)
            const base = Number.isFinite(q as number) ? (q as number) : 0
            return (
              <li
                key={item.id}
                className={`px-4 py-3 lg:flex lg:items-center lg:gap-3 lg:py-2.5 lg:pl-4 lg:pr-3${
                  item.id === novoId ? ' u-flash-in' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3 lg:min-w-0 lg:flex-1 lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium text-text">{item.descricao}</span>
                      {item.status && (
                        <span className="hidden shrink-0 lg:inline">
                          {item.status === 'Erro' ? (
                            <button
                              type="button"
                              onClick={() => toast.error('Erro neste item', { description: item.descricao_status ?? 'Sem detalhe disponível. Tente reenviar.' })}
                              title="Clique para ver o detalhe do erro"
                              className="cursor-pointer"
                            >
                              <StatusPill status={item.status} />
                            </button>
                          ) : (
                            <StatusPill status={item.status} />
                          )}
                        </span>
                      )}
                    </div>
                    <div className="num mt-0.5 text-[13px] text-text-muted">{item.codigo}</div>
                    {editavel ? (
                      <input
                        type="text"
                        value={obsItens[item.id] ?? ''}
                        maxLength={300}
                        onChange={(e) => setObsItens((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        onBlur={() => salvarObsItem(item.id)}
                        placeholder="Motivo (ex.: garrafa quebrada)"
                        aria-label={`Motivo de ${item.descricao}`}
                        className="mt-1.5 w-full max-w-md rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-text-muted focus:ring-2 focus:ring-brand/40 max-sm:text-base"
                      />
                    ) : item.obs_item ? (
                      <div className="mt-1 text-[13px] text-text">Motivo: {item.obs_item}</div>
                    ) : null}
                    {item.status && (
                      <div className="mt-1.5 lg:hidden">
                        {item.status === 'Erro' ? (
                          <button
                            type="button"
                            onClick={() => toast.error('Erro neste item', { description: item.descricao_status ?? 'Sem detalhe disponível. Tente reenviar.' })}
                            title="Clique para ver o detalhe do erro"
                            className="cursor-pointer"
                          >
                            <StatusPill status={item.status} />
                          </button>
                        ) : (
                          <StatusPill status={item.status} />
                        )}
                      </div>
                    )}
                  </div>
                  {editavel && (
                    <button
                      onClick={() => remover(item.id)}
                      disabled={pending}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-text-muted u-motion u-press hover:bg-surface-2 hover:text-err disabled:opacity-50 lg:order-last lg:size-8"
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
                    <span className="num text-[17px] font-semibold text-text lg:text-[15px]">{formatNumBR(q ?? 0)}</span>
                  ) : (
                    <div className="flex items-center gap-2 lg:gap-1.5">
                      <button
                        onClick={() => salvarQtd(item.id, Math.max(0, stepBase(texto, base) - 1))}
                        disabled={pending}
                        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text u-motion u-press hover:bg-[var(--border)] disabled:opacity-50 lg:size-8"
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
                        className="num h-11 w-20 rounded-[var(--r-md)] border-0 bg-surface-2 px-2 text-center text-[22px] font-semibold text-text outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-60 lg:h-8 lg:w-16 lg:text-[15px]"
                        placeholder="0"
                      />
                      <button
                        onClick={() => salvarQtd(item.id, stepBase(texto, base) + 1)}
                        disabled={pending}
                        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text u-motion u-press hover:bg-[var(--border)] disabled:opacity-50 lg:size-8"
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
        <div className="sticky bottom-16 z-20 -mx-4 mt-4 border-t border-border bg-surface/85 px-4 py-3 backdrop-blur-xl lg:bottom-0">
          <div className="flex justify-end">
            <button
              onClick={finalizar}
              disabled={pending}
              className={`${btnClass('primary')} h-11 w-full sm:h-10 sm:w-auto`}
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
