'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { Money } from '@/components/ui-kit/Money'
import { FUNDO_CLASSE, type CorToken } from '@/lib/status-cor'
import { previaGerarPedidos, rotuloEtapaRequisicao, type TomRequisicao } from '@/lib/compras/requisicao-puro'
import { gerarPedidosDasRequisicoes } from '@/lib/actions/requisicao-compra'
import type { RequisicaoResumo } from '@/app/(app)/requisicao-compra/dados'

const TOM_COR: Record<TomRequisicao, CorToken> = { ok: 'ok', aviso: 'warn', erro: 'err', neutro: 'neutro', info: 'info' }
const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const novaChave = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`)

/** Lista das requisições; as aprovadas podem ser marcadas para virar pedido (um rascunho por fornecedor). */
export function ListaRequisicoes({ requisicoes, compradores, podeGerar }: {
  requisicoes: RequisicaoResumo[]; compradores: Record<number, string>; podeGerar: boolean
}) {
  const router = useRouter()
  const [sel, setSel] = useState<Record<number, boolean>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [pend, start] = useTransition()
  const [chave, setChave] = useState(novaChave)
  const aprovadas = requisicoes.filter((r) => r.etapa === 'aprovada')
  const escolhidas = aprovadas.filter((r) => sel[r.id])
  const previa = useMemo(() => previaGerarPedidos(escolhidas.flatMap((r) => r.itens.map((i) => ({ ...i, requisicaoNumero: r.numero })))), [escolhidas])

  function gerar() {
    setMsg(null)
    start(async () => {
      const r = await gerarPedidosDasRequisicoes(escolhidas.map((x) => x.id), chave)
      if ('error' in r) { setMsg(r.error); return }
      setSel({}); setChave(novaChave())
      if (r.pedidos.length === 1) router.push(`/pedido-compra/${r.pedidos[0].id}`)
      else router.push(`/pedido-compra?criados=${r.pedidos.map((p) => p.numero).join(',')}`)
    })
  }

  return (
    <div className="space-y-3">
      {podeGerar && escolhidas.length > 0 && (
        <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
          <h2 className="text-[15px] font-semibold text-text">Gerar pedido de {escolhidas.length} requisição(ões)</h2>
          <ul className="space-y-1 text-[13px] text-text-muted">
            {previa.map((p) => (
              <li key={p.chave}><span className="text-text">{p.fornecedorNome}</span> · {p.itens.length} item(ns) · <span className="num">{brl(p.total)}</span> · requisições nº {p.requisicoes.join(', ')}</li>
            ))}
          </ul>
          <p className="text-[12px] text-text-muted">Cada fornecedor vira um pedido em rascunho; o mesmo produto é somado. Você confere preços e envia para aprovação.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnClass('primary')} disabled={pend} onClick={gerar}>{pend ? 'Gerando…' : `Gerar ${previa.length} pedido(s)`}</button>
            <button type="button" className={btnClass('outline')} onClick={() => setSel({})}>Limpar</button>
          </div>
          {msg && <p className="text-[13px] text-err">{msg}</p>}
        </section>
      )}
      {podeGerar && aprovadas.length > 1 && escolhidas.length === 0 && (
        <button type="button" className={btnClass('outline')} onClick={() => setSel(Object.fromEntries(aprovadas.map((r) => [r.id, true])))}>
          <ClipboardCheck className="size-4" /> Marcar as {aprovadas.length} aprovadas para gerar pedido
        </button>
      )}
      <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
        {requisicoes.map((r) => {
          const et = rotuloEtapaRequisicao(r.etapa)
          const fornecedores = [...new Set(r.itens.map((i) => i.fornecedorNome ?? 'a definir'))]
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              {podeGerar && (
                <span className="w-5 shrink-0">
                  {r.etapa === 'aprovada' && <input type="checkbox" aria-label={`Gerar pedido da requisição ${r.numero}`} checked={!!sel[r.id]}
                    onChange={(e) => setSel((s) => ({ ...s, [r.id]: e.target.checked }))} />}
                </span>
              )}
              <Link href={`/requisicao-compra/${r.id}`} className="grid min-w-0 flex-1 items-center gap-x-4 gap-y-1 u-motion hover:opacity-80 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-text">Nº {r.numero} · {r.itens.length} item(ns)</span>
                  <span className="block truncate text-[12px] text-text-muted">
                    {fornecedores.slice(0, 3).join(', ')}{fornecedores.length > 3 ? ` +${fornecedores.length - 3}` : ''} · criada {dataBR(r.createdAt)}{r.criadoPorNome ? ` por ${r.criadoPorNome}` : ''}
                    {r.compradorId && compradores[r.compradorId] ? ` · comprador ${compradores[r.compradorId]}` : ''}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text">
                  <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[TOM_COR[et.tom]]}`} aria-hidden />{et.rotulo}
                </span>
                <span className="text-[13px] text-text-muted">Entrega: <span className="num text-text">{dataBR(r.sugestaoEntrega)}</span></span>
                <span className="md:text-right"><Money value={r.valor} className="text-[14px] font-semibold" /></span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
