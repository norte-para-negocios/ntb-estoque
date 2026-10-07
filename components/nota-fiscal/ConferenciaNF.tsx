'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CheckCircle2, CircleAlert, Link2, PackageCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { SeletorProduto, campoCompra } from '@/components/compras-proprio/SeletorProduto'
import { buscarProdutosNF, confirmarEntradaNF, criarProdutoParaNF, definirLoteItemNF, vincularItemNF } from '@/lib/actions/nota-fiscal-proprio'
import { formatCustoUnit } from '@/lib/num-br'

export type ItemConferencia = {
  id: number; linha: number; descricao: string; cProd: string | null; unidade: string | null; quantidade: number; valorLiquido: number
  lancado: boolean; fator: number; custoUnitarioBase: number | null; matchOrigem: 'depara' | 'ean' | 'descricao' | 'manual' | null; score: number | null
  produto: { codigoProduto: number; codigo: string; descricao: string; unidade: string } | null
  sugestao: { codigoProduto: number; codigo: string; descricao: string; unidade: string } | null
  lote?: string | null
  validade?: string | null
}

const ORIGEM: Record<string, string> = { depara: 'de-para do fornecedor', ean: 'código de barras', descricao: 'nome parecido', manual: 'ligado por você' }
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function ConferenciaNF({ notaId, itens, status, locais, localAtual, podeConferir, alertas }: {
  notaId: number; itens: ItemConferencia[]; status: string; locais: { codigo: number; descricao: string }[]; localAtual: number | null; podeConferir: boolean; alertas: string[]
}) {
  const router = useRouter()
  const [local, setLocal] = useState<number | ''>(localAtual ?? locais[0]?.codigo ?? '')
  const [pending, start] = useTransition()
  const pendentes = itens.filter((i) => !i.lancado)
  const semProduto = pendentes.filter((i) => !i.produto).length
  const encerrada = status === 'cancelada'
  const editavel = podeConferir && !encerrada

  function confirmar() {
    if (local === '') { toast.error('Escolha o local que recebe a mercadoria'); return }
    start(async () => {
      const r = await confirmarEntradaNF(notaId, local)
      if ('error' in r) { toast.error('Não foi possível dar entrada', { description: r.error }); return }
      toast.success(r.status === 'lancada' ? 'Entrada lançada no estoque' : `${r.lancados} ${r.lancados === 1 ? 'item entrou' : 'itens entraram'} no estoque; ${r.pendentes} ainda sem produto`)
      router.refresh()
    })
  }

  if (!itens.length) return null
  return (
    <section className="space-y-3" aria-label="Conferência com o cadastro">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-semibold text-text">Conferência com o cadastro</h3>
          <p className="text-[13px] text-text-muted">
            {pendentes.length === 0 ? 'Todos os itens entraram no estoque.' : semProduto === 0 ? 'Todos os itens têm produto. Confira e dê entrada.' : `${semProduto} ${semProduto === 1 ? 'item ainda sem produto' : 'itens ainda sem produto'}. O sistema aprende cada ligação para as próximas notas do fornecedor.`}
          </p>
        </div>
        {editavel && pendentes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Local que recebe a mercadoria" className={`${campoCompra} w-auto`} value={local} onChange={(e) => setLocal(e.target.value ? Number(e.target.value) : '')}>
              {locais.map((l) => <option key={l.codigo} value={l.codigo}>{l.descricao}</option>)}
            </select>
            <button type="button" className={btnClass('primary')} onClick={confirmar} disabled={pending || pendentes.every((i) => !i.produto)}>
              {pending ? <Spinner /> : <PackageCheck className="size-4" />}Confirmar entrada
            </button>
          </div>
        )}
      </div>

      {alertas.length > 0 && (
        <ul className="space-y-1 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] shadow-[var(--shadow-sm)]">
          {alertas.map((a) => <li key={a} className="flex items-start gap-2 text-warn"><CircleAlert className="mt-0.5 size-4 shrink-0" />{a}</li>)}
        </ul>
      )}

      <ul className="divide-y divide-[var(--border)] rounded-[var(--r-lg)] bg-surface u-card">
        {itens.map((i) => <LinhaItem key={i.id} item={i} editavel={editavel && !i.lancado} encerrada={encerrada} />)}
      </ul>
    </section>
  )
}

function LinhaItem({ item, editavel, encerrada }: { item: ItemConferencia; editavel: boolean; encerrada: boolean }) {
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
          <p className="text-[14px] font-medium text-text">{item.descricao}</p>
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
            {item.matchOrigem && <span className="ml-2 rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-medium text-ok">{ORIGEM[item.matchOrigem]}</span>}</span>
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
