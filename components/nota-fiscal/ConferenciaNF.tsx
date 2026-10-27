'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CheckCircle2, CircleAlert, Link2, PackageCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { SeletorProduto, campoCompra } from '@/components/compras-proprio/SeletorProduto'
import { buscarProdutosNF, confirmarEntradaNF, criarProdutoParaNF, definirLoteItemNF, marcarConferidaNF, vincularItemNF } from '@/lib/actions/nota-fiscal-proprio'
import { formatCustoUnit } from '@/lib/num-br'
import type { AlertaItem } from '@/lib/estoque/nf-item-regras'
import { EditorItemNF } from './EditorItemNF'
import { PainelEntrada, type PassoEntrada } from './PainelEntrada'

export type ItemConferencia = {
  id: number; linha: number; descricao: string; cProd: string | null; unidade: string | null; quantidade: number; valorLiquido: number
  lancado: boolean; fator: number; custoUnitarioBase: number | null; matchOrigem: 'depara' | 'ean' | 'descricao' | 'manual' | null; score: number | null
  produto: { codigoProduto: number; codigo: string; descricao: string; unidade: string } | null
  sugestao: { codigoProduto: number; codigo: string; descricao: string; unidade: string } | null
  lote?: string | null
  validade?: string | null
  /** Fase B: configuração do item (local, CFOP de entrada, quantidade recebida, marcações…), valores fiscais, prévia e avisos. */
  config: {
    codigoLocal: number | null; cfopEntrada: string | null; origemCfop: string | null; quantidadeRecebida: number; unidadeEstoque: string | null
    flags: string | null; origemFlags: string | null; aliqCredPis: number; aliqCredCofins: number; movimentaEstoque: boolean; geraContaPagar: boolean
  }
  fiscal: {
    cst: string | null; csosn: string | null; credIcmsSn: number; icms: number; st: number; ipi: number; pis: number; cofins: number; frete: number; seguro: number; outras: number
    freteCte: number; valorTotalItem: number | null; desconto: number; valorProdutos: number; precoUnit: number
  }
  previa: { valorEstoque: number; custoUnitario: number | null } | null
  alertas: AlertaItem[]
  saldoAtual: number | null
  saldosPorLocal: Record<number, number>
}

/** Avisos que só passam com "Conferi os avisos" (mesma regra de decidirConferencia no servidor). */
const AVISOS_QUE_SEGURAM = new Set<AlertaItem['tipo']>(['fator_suspeito', 'custo_fora', 'valor_zero'])

const ORIGEM: Record<string, string> = { depara: 'mesmo código nas notas anteriores do fornecedor', ean: 'mesmo código de barras', descricao: 'nome parecido', manual: 'ligado por você' }
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Itens que ainda seguram a entrada (mesma conta do painel e do servidor). */
function faltasDaEntrada(itens: ItemConferencia[], faltaCategoria: boolean, semLocal: boolean, avisosAbertos: boolean) {
  const semProduto = itens.filter((i) => !i.lancado && !i.produto).length
  return [
    ...(semProduto > 0 ? [`Ligar ${semProduto} ${semProduto === 1 ? 'produto' : 'produtos'} ao cadastro`] : []),
    ...(faltaCategoria ? ['Escolher a categoria da nota'] : []),
    ...(semLocal ? ['Escolher o local'] : []),
    ...(avisosAbertos ? ['Conferir os avisos de custo'] : []),
  ]
}

/**
 * Itens da nota da loja própria (27/10/2026): uma lista só (antes eram "Conferência" + a tabela de itens). O que o
 * sistema ligou sozinho (de-para do fornecedor, código de barras) aparece como tal; o que ele só sugere tem "Usar"
 * e, de uma vez, "Aceitar as sugestões".
 */
export function ConferenciaNF({ itens, status, locais, podeConferir, alertas, extras }: {
  notaId: number; itens: ItemConferencia[]; status: string; locais: { codigo: number; descricao: string }[]; podeConferir: boolean; alertas: string[]
  /** Por linha da nota: etiqueta e categoria do item (vêm da página, que tem o item da nota). */
  extras?: Record<number, React.ReactNode>
}) {
  const router = useRouter()
  const [aceitando, startAceitar] = useTransition()
  const encerrada = status === 'cancelada'
  const editavel = podeConferir && !encerrada
  const pendentes = itens.filter((i) => !i.lancado)
  const semProduto = pendentes.filter((i) => !i.produto)
  const comSugestao = semProduto.filter((i) => i.sugestao)
  const sozinho = itens.filter((i) => i.produto && (i.matchOrigem === 'depara' || i.matchOrigem === 'ean')).length

  function aceitarSugestoes() {
    startAceitar(async () => {
      let ok = 0
      for (const i of comSugestao) {
        const r = await vincularItemNF(i.id, i.sugestao!.codigoProduto, 1)
        if ('error' in r) { toast.error(`Parei em "${i.descricao}"`, { description: r.error }); break }
        ok++
      }
      if (ok) toast.success(`${ok} ${ok === 1 ? 'item ligado' : 'itens ligados'} pela sugestão`, { description: 'Confira: se algum estiver errado, use "Trocar".' })
      router.refresh()
    })
  }

  if (!itens.length) return null
  return (
    <section className="rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]" aria-label="Itens da nota">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-2 pt-3.5">
        <h2 className="text-[16px] font-semibold text-text">Itens da nota <span className="font-normal text-text-muted">{itens.length}</span></h2>
        <p className="text-[13px] text-text-muted">
          {sozinho > 0 && <span><Sparkles className="mr-1 inline size-3.5 text-brand" />O sistema ligou {sozinho} sozinho</span>}
          {sozinho > 0 && (pendentes.length > 0 || semProduto.length > 0) && ' · '}
          {pendentes.length === 0 ? 'todos entraram no estoque' : semProduto.length === 0 ? 'todos com produto' : <span className="font-medium text-warn">falta ligar {semProduto.length}</span>}
        </p>
        {editavel && comSugestao.length > 0 && (
          <button type="button" className={`${btnClass('outline')} ml-auto`} disabled={aceitando} onClick={aceitarSugestoes}>
            {aceitando ? <Spinner /> : <Sparkles className="size-4" />}Aceitar {comSugestao.length === 1 ? 'a sugestão' : `as ${comSugestao.length} sugestões`}
          </button>
        )}
      </header>

      {alertas.length > 0 && (
        <ul className="mx-4 mb-2 space-y-1 rounded-[var(--r-md)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-[13px]">
          {alertas.map((a) => <li key={a} className="flex items-start gap-2 text-warn"><CircleAlert className="mt-0.5 size-4 shrink-0" />{a}</li>)}
        </ul>
      )}

      <ul className="divide-y divide-[var(--border)] border-t border-border">
        {itens.map((i) => <LinhaItem key={i.id} item={i} editavel={editavel && !i.lancado} encerrada={encerrada} locais={locais} extras={extras?.[i.linha]} />)}
      </ul>
    </section>
  )
}

/** Painel "Dar entrada no estoque" da loja própria: o que falta, local, conferida, totais e o botão. */
export function PainelEntradaProprio({ notaId, itens, status, locais, localAtual, podeConferir, conferidaEm, faltaCategoria = false, categoria, totais }: {
  notaId: number; itens: ItemConferencia[]; status: string; locais: { codigo: number; descricao: string }[]; localAtual: number | null; podeConferir: boolean
  conferidaEm?: string | null
  faltaCategoria?: boolean
  /** Bloco da categoria da nota (vem pronto da página). */
  categoria?: React.ReactNode
  totais: { mercadorias: number; outros: number; total: number }
}) {
  const router = useRouter()
  const [local, setLocal] = useState<number | ''>(localAtual ?? locais[0]?.codigo ?? '')
  const [pending, start] = useTransition()
  const [conferindo, startConferir] = useTransition()
  const [aceitarAvisos, setAceitarAvisos] = useState(false)
  const temAvisoQueSegura = itens.some((i) => !i.lancado && i.config.movimentaEstoque && i.alertas.some((a) => AVISOS_QUE_SEGURAM.has(a.tipo)))
  const pendentes = itens.filter((i) => !i.lancado)
  const avisosAbertos = temAvisoQueSegura && !conferidaEm && !aceitarAvisos
  const faltas = faltasDaEntrada(itens, faltaCategoria, local === '', avisosAbertos)
  const encerrada = status === 'cancelada'
  const editavel = podeConferir && !encerrada
  const semProduto = pendentes.filter((i) => !i.produto).length
  const nomeLocal = locais.find((l) => l.codigo === local)?.descricao ?? 'local escolhido'

  function confirmar() {
    if (local === '') { toast.error('Escolha o local que recebe a mercadoria'); return }
    start(async () => {
      // aviso de custo/fator sem conferência: o servidor exige "Conferi os avisos" (mesma regra da conferência)
      const r = await confirmarEntradaNF(notaId, local, { aceitarAvisos })
      if ('error' in r) { toast.error('Não foi possível dar entrada', { description: r.error }); return }
      toast.success(r.status === 'lancada' ? 'Entrada lançada no estoque' : `${r.lancados} ${r.lancados === 1 ? 'item entrou' : 'itens entraram'} no estoque; ${r.pendentes} ainda sem produto`)
      router.refresh()
    })
  }

  function marcarConferida() {
    startConferir(async () => {
      const r = await marcarConferidaNF(notaId, { aceitarAvisos })
      if ('error' in r) { toast.error('Ainda não dá para marcar como conferida', { description: r.error }); return }
      toast.success('Nota conferida', { description: 'Agora é só confirmar a entrada no estoque.' })
      router.refresh()
    })
  }

  const jaEntrou = itens.length > 0 && pendentes.length === 0
  const passos: PassoEntrada[] = jaEntrou ? [] : [
    { ok: semProduto === 0, texto: semProduto === 0 ? 'Todos os produtos ligados ao cadastro' : `Ligar ${semProduto} ${semProduto === 1 ? 'produto' : 'produtos'} ao cadastro` },
    { ok: !faltaCategoria, texto: faltaCategoria ? 'Escolher a categoria da nota' : 'Categoria da nota escolhida' },
    ...(temAvisoQueSegura ? [{ ok: !avisosAbertos, texto: avisosAbertos ? 'Conferir os avisos de custo' : 'Avisos de custo conferidos' }] : []),
  ]

  return (
    <PainelEntrada
      titulo={encerrada ? 'Nota cancelada' : jaEntrou ? 'Entrada feita' : 'Dar entrada no estoque'}
      passos={passos}
      totais={totais}
      rodape={editavel && pendentes.length > 0 ? (
        <div className="space-y-2">
          <button type="button" className={`${btnClass('primary')} w-full justify-center py-3 text-[15px]`} onClick={confirmar}
            disabled={pending || pendentes.every((i) => !i.produto) || faltaCategoria || avisosAbertos}
            title={avisosAbertos ? 'Há avisos de custo ou quantidade: confira e marque "Conferi os avisos".' : undefined}>
            {pending ? <Spinner /> : <PackageCheck className="size-4" />}Confirmar entrada
          </button>
          <p className="text-[12.5px] text-text-muted">
            {faltas.length === 0
              ? `Os ${pendentes.length} itens entram em ${nomeLocal} com o custo da nota.`
              : semProduto > 0 && faltas.length === 1
                ? `Dá para confirmar agora: entram os itens com produto e ${semProduto === 1 ? 'o item sem produto fica' : `os ${semProduto} sem produto ficam`} para depois.`
                : 'Resolva os itens marcados com ! para liberar.'}
          </p>
        </div>
      ) : jaEntrou && !encerrada ? <p className="text-[13px] text-text-muted">Os {itens.length} itens já entraram no estoque. Para desfazer, use &quot;Mais&quot; no topo.</p> : null}
    >
      {categoria}
      {editavel && pendentes.length > 0 && (
        <>
          <label className="grid gap-1 text-[13px] text-text-muted">
            Entra no local
            <select aria-label="Local que recebe a mercadoria" className={campoCompra} value={local} onChange={(e) => setLocal(e.target.value ? Number(e.target.value) : '')}>
              {locais.map((l) => <option key={l.codigo} value={l.codigo}>{l.descricao}</option>)}
            </select>
          </label>
          {conferidaEm
            ? <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok"><CheckCircle2 className="size-4" />Conferida</p>
            : (
              <div className="flex flex-wrap items-center gap-2">
                {temAvisoQueSegura && (
                  <label className="flex items-center gap-2 text-[13px] text-warn">
                    <input type="checkbox" className="size-4" checked={aceitarAvisos} onChange={(e) => setAceitarAvisos(e.target.checked)} />Conferi os avisos
                  </label>
                )}
                <button type="button" className={btnClass('outline')} onClick={marcarConferida} disabled={conferindo || (temAvisoQueSegura && !aceitarAvisos)}>
                  {conferindo ? <Spinner /> : <CheckCircle2 className="size-4" />}Marcar como conferida
                </button>
              </div>
            )}
        </>
      )}
    </PainelEntrada>
  )
}

function LinhaItem({ item, editavel, encerrada, locais, extras }: { item: ItemConferencia; editavel: boolean; encerrada: boolean; locais: { codigo: number; descricao: string }[]; extras?: React.ReactNode }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [trocando, setTrocando] = useState(false)
  const [fator, setFator] = useState(String(item.fator).replace('.', ','))
  const unidadesDiferem = !!item.produto && !!item.unidade && item.produto.unidade.toLowerCase() !== item.unidade.toLowerCase()

  function ligar(codigoProduto: number, f: number) {
    start(async () => {
      const r = await vincularItemNF(item.id, codigoProduto, f)
      if ('error' in r) { toast.error('Não foi possível ligar o produto', { description: r.error }); return }
      setTrocando(false); router.refresh()
    })
  }
  const fatorNum = Number(fator.replace(',', '.')) || 1

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[14px] font-medium text-text ${item.config.movimentaEstoque ? '' : 'line-through opacity-70'}`}>{item.descricao}</p>
          {!item.config.movimentaEstoque && <p className="text-[12px] text-text-muted">fica fora do estoque</p>}
          <p className="num text-[12px] text-text-muted">{item.cProd ? `${item.cProd} · ` : ''}{fmtQtd(item.quantidade)} {item.unidade ?? ''} · {fmtBRL(item.valorLiquido)}</p>
        </div>
        <div className="text-right text-[13px]">
          {item.lancado
            ? <p className="inline-flex items-center gap-1.5 font-medium text-ok"><CheckCircle2 className="size-4" />{encerrada ? 'estornado' : `entrou${item.custoUnitarioBase != null ? ` a ${formatCustoUnit(item.custoUnitarioBase, item.produto?.unidade)}` : ''}`}</p>
            : item.produto ? <p className="text-text-muted">aguardando entrada</p> : <p className="font-medium text-warn">sem produto</p>}
        </div>
      </div>

      {item.produto && !trocando && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-[13px]">
          <span className="min-w-0 truncate"><Link2 className="mr-1.5 inline size-4 text-text-muted" /><span className="num text-text-muted">{item.produto.codigo}</span> · {item.produto.descricao} <span className="text-text-muted">({item.produto.unidade})</span>
            {item.fator !== 1 && <span className="text-text-muted"> · 1 {item.unidade} = {fmtQtd(item.fator)} {item.produto.unidade}</span>}
            {item.matchOrigem && <span className="ml-2 rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-medium text-ok">{item.matchOrigem === 'depara' || item.matchOrigem === 'ean' ? <><Sparkles className="mr-0.5 inline size-3" />ligado sozinho · </> : null}{ORIGEM[item.matchOrigem]}</span>}</span>
          {editavel && <button type="button" className="text-text-muted hover:text-text" onClick={() => setTrocando(true)}>Trocar</button>}
        </div>
      )}

      {editavel && item.produto && unidadesDiferem && !trocando && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-text-muted">1 {item.unidade} =</span>
          <input inputMode="decimal" className={`${campoCompra} num w-28`} value={fator} onChange={(e) => setFator(e.target.value)} aria-label="Fator de conversão" />
          <span className="text-text-muted">{item.produto.unidade}</span>
          {fatorNum !== item.fator && <button type="button" className={btnClass('outline')} disabled={pending} onClick={() => ligar(item.produto!.codigoProduto, fatorNum)}>{pending && <Spinner />}Salvar fator</button>}
        </div>
      )}

      {(item.produto || item.lote || item.validade) && <LoteItem item={item} editavel={editavel} />}

      <EditorItemNF item={item} locais={locais} editavel={editavel} />
      {extras}

      {editavel && !item.produto && (
        <div className="space-y-2">
          {item.sugestao && (
            <button type="button" disabled={pending} onClick={() => ligar(item.sugestao!.codigoProduto, 1)}
              className="flex w-full items-center justify-between gap-2 rounded-[var(--r-md)] bg-brand/10 px-3 py-2 text-left text-[13px] hover:bg-brand/15">
              <span className="min-w-0 truncate"><Sparkles className="mr-1.5 inline size-4 text-brand" />Sugestão: <span className="num text-text-muted">{item.sugestao.codigo}</span> · {item.sugestao.descricao} <span className="text-text-muted">({item.sugestao.unidade})</span></span>
              <span className="shrink-0 font-medium text-brand">{pending ? <Spinner /> : 'Usar'}</span>
            </button>
          )}
          <SeletorProduto value={null} buscar={buscarProdutosNF} criarProduto={criarProdutoParaNF} sugestaoDescricao={item.descricao} sugestaoUnidade={item.unidade ?? undefined}
            onChange={(p) => { if (p) ligar(p.codigoProduto, 1) }} />
        </div>
      )}

      {editavel && trocando && (
        <div className="space-y-2">
          <SeletorProduto value={null} buscar={buscarProdutosNF} criarProduto={criarProdutoParaNF} sugestaoDescricao={item.descricao} sugestaoUnidade={item.unidade ?? undefined}
            onChange={(p) => { if (p) ligar(p.codigoProduto, 1) }} />
          <button type="button" className="text-[13px] text-text-muted hover:text-text" onClick={() => setTrocando(false)}>Cancelar a troca</button>
        </div>
      )}
    </li>
  )
}

const dataBR = (iso: string) => iso.split('-').reverse().join('/')

/** Lote e validade do item: editável até a entrada; depois só leitura. Vem do XML quando a nota traz (grupo rastro). */
function LoteItem({ item, editavel }: { item: ItemConferencia; editavel: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [lote, setLote] = useState(item.lote ?? '')
  const [validade, setValidade] = useState(item.validade ?? '')
  const mudou = lote !== (item.lote ?? '') || validade !== (item.validade ?? '')

  if (!editavel) {
    if (!item.lote && !item.validade) return null
    return (
      <p className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
        <CalendarClock className="size-3.5" />
        {item.lote && <span>lote <span className="num text-text">{item.lote}</span></span>}
        {item.lote && item.validade && <span>·</span>}
        {item.validade && <span>validade <span className="num text-text">{dataBR(item.validade)}</span></span>}
      </p>
    )
  }
  function salvar() {
    start(async () => {
      const r = await definirLoteItemNF(item.id, lote, validade || null)
      if ('error' in r) { toast.error('Não foi possível salvar o lote', { description: r.error }); return }
      toast.success('Lote salvo', { description: 'Entra com esse lote e validade na confirmação.' })
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <CalendarClock className="size-4 text-text-muted" />
      <input aria-label="Lote" placeholder="Lote (opcional)" className={`${campoCompra} w-36`} value={lote} onChange={(e) => setLote(e.target.value)} />
      <input aria-label="Validade" type="date" className={`${campoCompra} w-40`} value={validade} onChange={(e) => setValidade(e.target.value)} />
      {mudou && <button type="button" className={btnClass('outline')} disabled={pending} onClick={salvar}>{pending && <Spinner />}Salvar lote</button>}
      {!mudou && (item.lote || item.validade) && <span className="text-[12px] text-text-muted">vai entrar com este lote</span>}
    </div>
  )
}
