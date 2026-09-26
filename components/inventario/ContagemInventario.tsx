'use client'

import { useMemo, useState, useTransition } from 'react'
import { precisaEnviar } from '@/lib/inventario/contagem-regras'
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
import { parseNumBR, formatNumBR } from '@/lib/num-br'

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

// Base do stepper +/-: prioriza o que esta DIGITADO agora (texto cru, pode ter
// virgula e ainda nao ter dado blur); se invalido, cai no number ja salvo.
function stepBase(texto: string, fallback: number): number {
  const p = parseNumBR(texto)
  return p != null && Number.isFinite(p) ? p : fallback
}

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
  podeEditar = true,
}: {
  inventarioId: number
  itensIniciais: ItemContagem[]
  finalizado: boolean
  podeEditar?: boolean
}) {
  const [itens, setItens] = useState(itensIniciais)
  // Texto CRU do input de quantidade: mantido separado do number pra que a virgula
  // fique enquanto o usuario digita ("3,4"). Se o input fosse controlado pelo
  // number, parseNumBR("3,") devolveria 3 e o React reescreveria o campo como "3",
  // comendo a virgula. So convertemos pra number no blur (salvar).
  const [textos, setTextos] = useState<Record<number, string>>(() =>
    Object.fromEntries(itensIniciais.map((i) => [i.id, formatNumBR(i.quan)]))
  )
  const [filtro, setFiltro] = useState('')
  // id do item recem-adicionado: a linha nova ganha o flash de entrada (u-flash-in).
  const [novoId, setNovoId] = useState<number | null>(null)
  // Inventario finalizado entra em modo leitura; "Editar itens" destrava os
  // controles para corrigir/excluir um item depois de finalizado (o servidor
  // exclui o ajuste antigo no Omie e relanca a nova quantidade).
  const [editando, setEditando] = useState(false)
  const [pending, startTransition] = useTransition()
  // Itens com envio ao Omie em andamento. Antes era um `pending` unico que
  // desabilitava TODOS os campos enquanto qualquer item processava -- com o Omie
  // lento/bloqueado a tela inteira travava (2026-09-24). Agora so trava a linha.
  const [enviando, setEnviando] = useState<Set<number>>(() => new Set())
  const router = useRouter()
  // Controles de quantidade/remocao liberados: durante a contagem (nao finalizado)
  // ou quando o usuario clica em "Editar itens" num inventario finalizado.
  // Requer tambem podeEditar (permissao Inventarios - Editar).
  const editavel = podeEditar && (!finalizado || editando)

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
  // (reprocessa ao mexer na quantidade). Erro num item nao trava os outros.
  function salvarQtd(itemId: number, num: number | null) {
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade inválida')
      return
    }
    // No inventario a contagem 0 e VALIDA (zera o saldo) e vai pro Omie; so o campo
    // VAZIO (null) fica pendente como 'Vazio' (rotulo "Sem quantidade") e e
    // descartado ao finalizar — nao trava o inventario nem conta no placar.
    setTextos((prev) => ({ ...prev, [itemId]: formatNumBR(num) }))
    if (enviando.has(itemId) || !precisaEnviar(itens.find((i) => i.id === itemId), num)) return
    setEnviando((prev) => new Set(prev).add(itemId))
    setItens((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? { ...i, quan: num, status: num != null ? 'Processando' : 'Vazio' }
          : i
      )
    )
    void (async () => {
      let res: Awaited<ReturnType<typeof enviarInventarioItem>>
      try {
        res = await enviarInventarioItem(itemId, num)
      } catch {
        setItens((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: 'Erro' } : i)))
        toast.error('Falha ao integrar item', { description: 'Sem resposta do servidor. Tente reenviar.' })
        return
      } finally {
        setEnviando((prev) => {
          const novo = new Set(prev)
          novo.delete(itemId)
          return novo
        })
      }
      const statusUi = res.status === 'Iniciado' ? 'Vazio' : res.status
      setItens((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, status: statusUi } : i))
      )
      if (res.status === 'Sem CMC') {
        toast.warning('Sem custo no Omie ainda', {
          description: 'O produto ainda não tem custo médio fechado no Omie. Reenvie quando o custo aparecer.',
        })
      } else if (res.status === 'Erro') {
        toast.error('Falha ao integrar item', {
          description: res.descricao_status || 'Tente reenviar',
        })
      } else if (res.status === 'Concluido') {
        toast.success('Item integrado ao Omie')
      }
    })()
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
    // Avisa antes de fechar se ha item sem quantidade (sera ignorado) ou com erro
    // (nao integrou). Evita concluir sem querer deixando produto de fora.
    const semQtd = itens.filter((i) => i.status === 'Vazio' || i.quan == null).length
    const erros = itens.filter((i) => i.status === 'Erro').length
    if (semQtd > 0 || erros > 0) {
      const partes: string[] = []
      if (semQtd > 0) partes.push(`${semQtd} item(ns) sem quantidade serão ignorados`)
      if (erros > 0) partes.push(`${erros} item(ns) com erro não foram integrados`)
      if (!window.confirm(`Concluir o inventário?\n\n${partes.join('\n')}.\n\nDeseja continuar mesmo assim?`)) return
    }
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
  // durante a contagem tambem (e o botao de reenviar pendentes quando ha erro ou
  // quando ha itens 'Iniciado' com quantidade num inventario finalizado).
  // Itens VAZIOS (sem quantidade contada) nao entram no placar: sao descartados ao
  // finalizar. No inventario a contagem 0 conta normal (zerar saldo e valido); so
  // o campo vazio (quan null) e ignorado.
  const vazios = itens.filter((i) => i.status === 'Vazio' || i.quan == null).length
  const comQtd = itens.filter((i) => !(i.status === 'Vazio' || i.quan == null))
  const total = comQtd.length
  const integrados = comQtd.filter((i) => i.status === 'Concluido').length
  // 'Erro' = falha real de integracao. 'Sem CMC' = o produto ainda nao tem custo
  // medio fechado no Omie; nao e erro nosso, entao contamos separado para nao virar
  // alerta vermelho eterno. Reenviar resolve quando o Omie fechar o custo.
  const comErro = comQtd.filter((i) => i.status === 'Erro').length
  const semCusto = comQtd.filter((i) => i.status === 'Sem CMC').length
  // Itens 'Iniciado' com quantidade: ficaram pendentes (network error, item adicionado
  // pos-finalizacao etc.). Num inventario finalizado esses itens nunca chegaram ao Omie
  // e o botao de reenvio nao aparecia. Agora entram no criterio de "tem pendentes".
  const comIniciado = comQtd.filter((i) => i.status === 'Iniciado' || i.status === 'Processando').length
  const temPendentes = comErro > 0 || semCusto > 0 || (finalizado && comIniciado > 0)
  // Cor do aviso: vermelho so com erro real; amarelo com sem-custo/pendente; verde ok.
  const tomBanner = comErro > 0 ? 'bg-err' : semCusto > 0 || (finalizado && comIniciado > 0) ? 'bg-warn' : 'bg-ok'

  return (
    <div className="pb-28 lg:pb-20">
      {total > 0 && (integrados > 0 || temPendentes || finalizado) && (
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
            {comIniciado > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-normal text-text-muted">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
                <span className="num">{comIniciado}</span> pendente{comIniciado > 1 ? 's' : ''}
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
            {temPendentes && (
              <button onClick={reenviar} disabled={pending || enviando.size > 0} className={btnClass('outline')}>
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
          Editando um inventário finalizado. Ao alterar a quantidade ou excluir um item, o ajuste já
          lançado no Omie é refeito ou removido na hora.</span>
        </p>
      )}

      {editavel && (
        <div className="sticky top-0 z-30 -mx-4 mb-4 space-y-2 border-b border-border/60 bg-bg/85 px-4 py-3 backdrop-blur-xl sm:mx-0 sm:rounded-[var(--r-lg)] sm:border-0 sm:bg-surface/85 sm:px-3 sm:shadow-[var(--shadow-sm)]">
          {/* Busca manual ACIMA do QR (padrao em todas as contagens). Liberado tambem
              ao "Editar itens" num inventario finalizado: adicionar produto pos-fato. */}
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
            className="w-full rounded-[var(--r-md)] border-0 bg-surface-2 py-2.5 pl-9 pr-3 text-sm text-text outline-none max-sm:text-base transition-colors placeholder:text-text-muted focus:ring-2 focus:ring-brand/40"
          />
        </div>
      )}

      {visiveis.length ? (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
          {visiveis.map((item) => {
            const q = item.quan
            const texto = textos[item.id] ?? ''
            // base finita para os botoes +/- (evita NaN propagando). quan pode vir
            // como string numerica do banco ("3.00"), entao coage via Number.
            const qn = q == null ? NaN : Number(q)
            const base = Number.isFinite(qn) ? qn : 0
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
                      <span className="truncate text-[15px] font-medium text-text">{item.produto_descricao}</span>
                      {item.status && (
                        <span className="hidden shrink-0 lg:inline">
                          <StatusPill status={item.status} />
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[13px] text-text-muted">
                      <span className="num">{item.produto_codigo}</span>
                      {item.produto_familia && (
                        <span className="hidden truncate text-[12px] text-text-muted lg:inline">· {item.produto_familia}</span>
                      )}
                    </div>
                    {item.produto_familia && (
                      <div className="mt-0.5 text-[12px] text-text-muted lg:hidden">{item.produto_familia}</div>
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
                      disabled={pending || enviando.has(item.id)}
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
                        disabled={enviando.has(item.id)}
                        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text u-motion u-press hover:bg-[var(--border)] disabled:opacity-50 lg:size-8"
                        aria-label="Diminuir"
                      >
                        <Minus className="size-4 lg:size-3.5" />
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={texto}
                        disabled={enviando.has(item.id)}
                        onChange={(e) => {
                          // Guarda a string CRUA (a virgula fica enquanto digita).
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
                        disabled={enviando.has(item.id)}
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
              disabled={pending || enviando.size > 0}
              className={`${btnClass('primary')} h-11 w-full sm:h-10 sm:w-auto`}
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
