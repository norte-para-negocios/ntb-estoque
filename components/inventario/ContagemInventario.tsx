'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { precisaEnviar } from '@/lib/inventario/contagem-regras'
import {
  STATUS_NAO_SALVO,
  aplicarPendentes,
  chavePendentes,
  confirmarPendente,
  descartarPendentes,
  ehVersaoVelha,
  guardarPendente,
  lerPendentes,
  podeRecarregar,
  type Armazenamento,
} from '@/lib/inventario/contagem-pendente'
import dynamic from 'next/dynamic'
import { useRouter, unstable_isUnrecognizedActionError } from 'next/navigation' // router ainda usado no finalizar
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
  informarMotivoInventarioItem,
} from '@/lib/actions/inventario'

const SEM_ARMAZENAMENTO: Armazenamento = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

function armazenamento(): Armazenamento {
  try {
    return window.localStorage
  } catch {
    return SEM_ARMAZENAMENTO
  }
}

// Tela aberta antes de um deploy: o servidor não conhece mais a ação (ver contagem-pendente.ts).
function versaoVelha(e: unknown): boolean {
  return unstable_isUnrecognizedActionError(e) || ehVersaoVelha(e)
}

const CHAVE_ULTIMA_RECARGA = 'ntb:contagem-recarga-em'
const REENVIO_MS = 30_000

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
  // Só em loja de estoque próprio: diferença lançada, motivo e mensagem do item.
  diferenca?: number | null
  motivo?: string | null
  descricao_status?: string | null
}

export function ContagemInventario({
  lojaId,
  inventarioId,
  itensIniciais,
  finalizado,
  podeEditar = true,
  proprio = false,
}: {
  lojaId: number
  inventarioId: number
  itensIniciais: ItemContagem[]
  finalizado: boolean
  podeEditar?: boolean
  // Loja de estoque próprio: o ajuste vai para o estoque da própria loja (sem Omie) e diferenças grandes pedem motivo.
  proprio?: boolean
}) {
  const [motivos, setMotivos] = useState<Record<number, string>>({})
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

  // Contagem digitada fica no aparelho até o servidor responder (ver contagem-pendente.ts).
  const chave = chavePendentes(lojaId, inventarioId)
  const itensRef = useRef(itens)
  useEffect(() => {
    itensRef.current = itens
  }, [itens])
  const enviandoRef = useRef(enviando)
  useEffect(() => {
    enviandoRef.current = enviando
  }, [enviando])
  const recarregandoRef = useRef(false)
  const [reenviando, setReenviando] = useState(false)

  // Versão velha: recarrega (a cópia no aparelho sobrevive) e as pendentes saem sozinhas depois.
  const recarregarPorVersao = useCallback(() => {
    if (recarregandoRef.current) return
    const agora = Date.now()
    let ultima: number | null = null
    try {
      ultima = Number(window.sessionStorage.getItem(CHAVE_ULTIMA_RECARGA)) || null
    } catch {}
    if (!podeRecarregar(ultima, agora)) {
      toast.error('O servidor não aceitou a contagem', {
        id: 'contagem-nao-salva',
        duration: Infinity,
        description: 'Ela está guardada neste aparelho e será enviada sozinha. Se continuar assim, avise o suporte.',
      })
      return
    }
    recarregandoRef.current = true
    try {
      window.sessionStorage.setItem(CHAVE_ULTIMA_RECARGA, String(agora))
    } catch {}
    // Campo ainda em edição: o blur guarda o número no aparelho antes de recarregar.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    toast.info('O sistema foi atualizado', {
      id: 'contagem-recarregar',
      duration: Infinity,
      description: 'Recarregando a tela. Suas contagens estão guardadas e serão enviadas sozinhas.',
    })
    window.setTimeout(() => window.location.reload(), 1500)
  }, [])

  // Erro de ação que não é a contagem (adicionar, remover, concluir...): nada é perdido, mas
  // com versão velha só recarregando volta a funcionar.
  function tratarFalha(e: unknown, titulo: string) {
    if (versaoVelha(e)) recarregarPorVersao()
    else toast.error(titulo, { description: 'Sem resposta do servidor. Tente de novo.' })
  }

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
      let novo: Awaited<ReturnType<typeof addInventarioItem>>
      try {
        novo = await addInventarioItem(inventarioId, {
          produto_codigo_produto: p.codigo_produto,
          produto_codigo: p.codigo,
          produto_descricao: p.descricao,
          produto_familia: p.descricao_familia,
        })
      } catch (e) {
        tratarFalha(e, 'Não foi possível adicionar o produto')
        return
      }
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
    let p: Awaited<ReturnType<typeof buscarProdutoPorCodigo>>
    try {
      p = await buscarProdutoPorCodigo(codigo)
    } catch (e) {
      tratarFalha(e, 'Não foi possível buscar o produto')
      return false
    }
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
    void enviarQtd(itemId, num)
  }

  // Devolve true se o servidor respondeu (ou não precisava enviar); false se a contagem ficou
  // só no aparelho ("Não salvo").
  async function enviarQtd(itemId: number, num: number | null): Promise<boolean> {
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade inválida')
      return true
    }
    // No inventario a contagem 0 e VALIDA (zera o saldo) e vai pro Omie; so o campo
    // VAZIO (null) fica pendente como 'Vazio' (rotulo "Sem quantidade") e e
    // descartado ao finalizar — nao trava o inventario nem conta no placar.
    setTextos((prev) => ({ ...prev, [itemId]: formatNumBR(num) }))
    if (enviandoRef.current.has(itemId)) return true
    if (!precisaEnviar(itensRef.current.find((i) => i.id === itemId), num)) {
      descartarPendentes(armazenamento(), chave, [itemId])
      return true
    }
    // Antes de qualquer envio: o número já está salvo no aparelho.
    const { em } = guardarPendente(armazenamento(), chave, itemId, num)
    enviandoRef.current = new Set(enviandoRef.current).add(itemId)
    setEnviando((prev) => new Set(prev).add(itemId))
    setItens((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? { ...i, quan: num, status: num != null ? 'Processando' : 'Vazio' }
          : i
      )
    )
    let res: Awaited<ReturnType<typeof enviarInventarioItem>>
    try {
      res = await enviarInventarioItem(itemId, num)
    } catch (e) {
      setItens((prev) => prev.map((i) => (i.id === itemId ? { ...i, quan: num, status: STATUS_NAO_SALVO } : i)))
      if (versaoVelha(e)) recarregarPorVersao()
      else
        toast.warning('Contagem guardada no aparelho', {
          id: 'contagem-nao-salva',
          description: 'O servidor não respondeu. Ela será enviada sozinha assim que ele voltar.',
        })
      return false
    } finally {
      const novo = new Set(enviandoRef.current)
      novo.delete(itemId)
      enviandoRef.current = novo
      setEnviando((prev) => {
        const s = new Set(prev)
        s.delete(itemId)
        return s
      })
    }
    // O servidor recebeu (mesmo que o Omie tenha recusado: aí o item fica Erro/Sem CMC lá).
    confirmarPendente(armazenamento(), chave, itemId, em)
    {
      const statusUi = res.status === 'Iniciado' ? 'Vazio' : res.status
      setItens((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, status: statusUi, diferenca: res.diferenca ?? null, descricao_status: res.descricao_status ?? null } : i))
      )
      if (res.status === 'Sem CMC') {
        toast.warning('Sem custo no Omie ainda', {
          description: 'O produto ainda não tem custo médio fechado no Omie. Reenvie quando o custo aparecer.',
        })
      } else if (res.status === 'Erro') {
        toast.error('Falha ao integrar item', {
          description: res.descricao_status || 'Tente reenviar',
        })
      } else if (res.status === 'Aguardando motivo') {
        toast.warning('Diferença grande: informe o motivo', { description: res.descricao_status ?? undefined })
      } else if (res.status === 'Concluido') {
        toast.success(proprio ? 'Item lançado no estoque' : 'Item integrado ao Omie')
      }
    }
    return true
  }

  const enviarQtdRef = useRef(enviarQtd)
  useEffect(() => {
    enviarQtdRef.current = enviarQtd
  })

  // Reenvia, um por vez, o que ficou só no aparelho. Para no 1º que falhar (servidor ainda fora).
  const reenviarNaoSalvos = useCallback(async () => {
    if (recarregandoRef.current) return
    const fila = itensRef.current.filter((i) => i.status === STATUS_NAO_SALVO)
    if (fila.length === 0) return
    setReenviando(true)
    try {
      for (const i of fila) {
        if (!(await enviarQtdRef.current(i.id, i.quan))) break
      }
    } finally {
      setReenviando(false)
    }
  }, [])

  // Ao abrir (inclusive depois da recarga automática): devolve à tela o que ficou no aparelho
  // e reenvia sozinho.
  useEffect(() => {
    if (!podeEditar) return
    const st = armazenamento()
    const { itens: comPendentes, aplicados, descartar } = aplicarPendentes(itensRef.current, lerPendentes(st, chave))
    descartarPendentes(st, chave, descartar)
    if (aplicados.length === 0) return
    itensRef.current = comPendentes
    setItens(comPendentes)
    setTextos((prev) => {
      const t = { ...prev }
      for (const i of comPendentes) if (aplicados.includes(i.id)) t[i.id] = formatNumBR(i.quan)
      return t
    })
    toast.info(`${aplicados.length} contagem(ns) guardada(s) neste aparelho`, {
      id: 'contagem-recuperada',
      description: 'Enviando ao servidor agora.',
    })
    void reenviarNaoSalvos()
  }, [chave, podeEditar, reenviarNaoSalvos])

  // Enquanto houver contagem só no aparelho: tenta de novo a cada 30 s e quando a internet volta.
  const naoSalvos = itens.filter((i) => i.status === STATUS_NAO_SALVO).length
  useEffect(() => {
    if (naoSalvos === 0) return
    const tentar = () => void reenviarNaoSalvos()
    const t = window.setInterval(tentar, REENVIO_MS)
    window.addEventListener('online', tentar)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('online', tentar)
    }
  }, [naoSalvos, reenviarNaoSalvos])

  function informarMotivo(itemId: number) {
    const texto = (motivos[itemId] ?? '').trim()
    if (texto.length < 3) return
    setEnviando((prev) => new Set(prev).add(itemId))
    setItens((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: 'Processando' } : i)))
    void (async () => {
      try {
        const res = await informarMotivoInventarioItem(itemId, texto)
        setItens((prev) =>
          prev.map((i) =>
            i.id === itemId ? { ...i, status: res.status, diferenca: res.diferenca ?? null, descricao_status: res.descricao_status ?? null, motivo: texto } : i
          )
        )
        if (res.status === 'Concluido') toast.success('Item lançado no estoque')
        else toast.error('Não foi possível lançar', { description: res.descricao_status ?? undefined })
      } catch (e) {
        setItens((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: 'Aguardando motivo' } : i)))
        tratarFalha(e, 'Falha ao lançar item')
      } finally {
        setEnviando((prev) => {
          const novo = new Set(prev)
          novo.delete(itemId)
          return novo
        })
      }
    })()
  }

  function remover(itemId: number) {
    if (finalizado && !window.confirm(`Excluir este item? O ajuste já lançado ${proprio ? 'no estoque' : 'no Omie'} será removido.`)) {
      return
    }
    const anterior = itens
    setItens((prev) => prev.filter((i) => i.id !== itemId))
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof removeInventarioItem>>
      try {
        res = await removeInventarioItem(itemId)
      } catch (e) {
        setItens(anterior)
        tratarFalha(e, 'Erro ao remover')
        return
      }
      if (res?.error) {
        setItens(anterior) // desfaz o otimismo se o servidor recusar
        toast.error('Erro ao remover', { description: res.error })
      } else {
        toast.success('Item removido')
      }
    })
  }

  function finalizar() {
    if (naoSalvos > 0) {
      toast.error('Ainda há contagens não salvas', {
        description: 'Espere elas serem enviadas (ou toque em "Enviar agora") antes de concluir.',
      })
      return
    }
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
      let res: Awaited<ReturnType<typeof finishInventario>>
      try {
        res = await finishInventario(inventarioId)
      } catch (e) {
        tratarFalha(e, 'Não foi possível concluir o inventário')
        return
      }
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success(proprio ? 'Inventário concluído' : 'Inventário enviado ao Omie')
        router.refresh()
      }
    })
  }

  function reenviar() {
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof forceSyncInventario>>
      try {
        res = await forceSyncInventario(inventarioId)
      } catch (e) {
        tratarFalha(e, 'Não foi possível reenviar')
        return
      }
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success(proprio ? 'Pendentes reenviados' : 'Reenviado ao Omie')
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
  const aguardandoMotivo = comQtd.filter((i) => i.status === 'Aguardando motivo').length
  const temPendentes = comErro > 0 || semCusto > 0 || aguardandoMotivo > 0 || (finalizado && comIniciado > 0)
  // Cor do aviso: vermelho so com erro real; amarelo com sem-custo/pendente; verde ok.
  const tomBanner = comErro > 0 ? 'bg-err' : semCusto > 0 || aguardandoMotivo > 0 || (finalizado && comIniciado > 0) ? 'bg-warn' : 'bg-ok'

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
                <span className="num">{integrados}</span> de <span className="num">{total}</span> produtos {proprio ? 'lançados no estoque' : 'integrados ao Omie'}
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
                <span className="num">{semCusto}</span> sem custo ({proprio ? 'custo ainda zerado' : 'aguardando o Omie'})
              </span>
            )}
            {aguardandoMotivo > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-normal text-text-muted">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
                <span className="num">{aguardandoMotivo}</span> aguardando motivo
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

      {naoSalvos > 0 && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-lg)] bg-surface px-4 py-3 shadow-[var(--shadow-sm)]"
        >
          <span className="flex items-start gap-2 text-[14px] text-text">
            <span aria-hidden className="mt-[6px] size-2 shrink-0 rounded-full bg-warn" />
            <span>
              <span className="font-semibold">
                <span className="num">{naoSalvos}</span> contagem{naoSalvos > 1 ? 'ns' : ''} ainda não salva{naoSalvos > 1 ? 's' : ''} no servidor.
              </span>{' '}
              <span className="text-text-muted">Está{naoSalvos > 1 ? 'ão' : ''} guardada{naoSalvos > 1 ? 's' : ''} neste aparelho e será{naoSalvos > 1 ? 'ão' : ''} enviada{naoSalvos > 1 ? 's' : ''} sozinha{naoSalvos > 1 ? 's' : ''}. Não conclua o inventário até este aviso sumir.</span>
            </span>
          </span>
          <button onClick={() => void reenviarNaoSalvos()} disabled={reenviando} className={btnClass('outline')}>
            {reenviando && <Spinner />}
            {reenviando ? 'Enviando...' : 'Enviar agora'}
          </button>
        </div>
      )}

      {editando && (
        <p className="mb-4 flex items-start gap-2 px-1 text-[13px] text-text-muted">
          <span aria-hidden className="mt-[5px] size-2 shrink-0 rounded-full bg-warn" />
          <span>
          Editando um inventário finalizado. Ao alterar a quantidade ou excluir um item, o ajuste já
          lançado {proprio ? 'no estoque' : 'no Omie'} é refeito ou removido na hora.</span>
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
                    {proprio && item.diferenca != null && item.diferenca !== 0 && item.status !== 'Vazio' && (
                      <div className={`mt-1 text-[12px] font-medium ${item.diferenca < 0 ? 'text-err' : 'text-ok'}`}>
                        Diferença: <span className="num">{item.diferenca > 0 ? '+' : ''}{formatNumBR(item.diferenca)}</span>
                        {item.unidade ? ` ${item.unidade}` : ''}
                        {item.motivo ? <span className="font-normal text-text-muted"> · {item.motivo}</span> : null}
                      </div>
                    )}
                    {proprio && item.status === 'Aguardando motivo' && editavel && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="w-full text-[12px] text-text-muted">{item.descricao_status}</span>
                        <input
                          type="text"
                          value={motivos[item.id] ?? ''}
                          onChange={(e) => setMotivos((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Motivo da diferença (ex.: quebra, perda, erro de lançamento)"
                          className="h-9 min-w-[14rem] flex-1 rounded-[var(--r-md)] border-0 bg-surface-2 px-3 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40"
                        />
                        <button
                          type="button"
                          disabled={enviando.has(item.id) || (motivos[item.id] ?? '').trim().length < 3}
                          onClick={() => informarMotivo(item.id)}
                          className={btnClass('primary')}
                        >
                          Lançar com motivo
                        </button>
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
              disabled={pending || enviando.size > 0 || naoSalvos > 0}
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
