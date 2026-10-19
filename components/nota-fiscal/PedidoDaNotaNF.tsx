'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { btnClass } from '@/components/ui-kit/Button'
import { desvincularNotaDoPedido, vincularNotaAoPedido } from '@/lib/actions/pedido-compra'
import type { SituacaoConf } from '@/lib/compras/pedido-puro'
import type { PedidoDaNota } from '@/app/(app)/nota-fiscal/[id]/dados-pedido'

const q = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 3 }))
const brl = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 }))
const SIT: Record<SituacaoConf, { txt: string; cor: string }> = {
  ok: { txt: 'Quantidade certa', cor: 'text-ok' }, falta: { txt: 'Veio menos', cor: 'text-warn' }, excede: { txt: 'Veio mais', cor: 'text-warn' },
  nao_veio: { txt: 'Não veio nesta nota', cor: 'text-text-muted' }, fora_do_pedido: { txt: 'Fora do pedido', cor: 'text-err' },
}
const th = 'whitespace-nowrap px-2.5 py-2 text-[12px] font-semibold text-text-muted'

// Seção da nota (estoque próprio): ligar a nota ao pedido de compra aprovado e conferir pedido × nota × recebido.
export function PedidoDaNotaNF({ compraId, dados, podeVincular }: { compraId: number; dados: PedidoDaNota; podeVincular: boolean }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const rodar = (f: () => Promise<{ error: string } | { ok: true; vinculados?: number; foraDoPedido?: number; emOutroPedido?: number }>) => {
    setMsg(null)
    start(async () => {
      const r = await f()
      if ('error' in r) setMsg(r.error)
      else {
        if (r.vinculados != null) setMsg(`${r.vinculados} item(ns) ligados ao pedido${r.foraDoPedido ? `, ${r.foraDoPedido} fora do pedido` : ''}${r.emOutroPedido ? `, ${r.emOutroPedido} já em outro pedido` : ''}.`)
        router.refresh()
      }
    })
  }
  if (!dados.vinculados.length && !dados.sugestoes.length) return null

  return (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <h2 className="text-[15px] font-semibold text-text">Pedido de compra</h2>
      {dados.vinculados.length === 0 && (
        <div className="space-y-2">
          <p className="text-[13px] text-text-muted">Pedidos aprovados que podem ser desta nota (mesmo fornecedor e produtos em comum):</p>
          <ul className="divide-y divide-[var(--border)]">
            {dados.sugestoes.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <Link href={`/pedido-compra/${s.id}`} className="text-text hover:underline">
                  Nº {s.numero} · {s.fornecedor} · {s.comuns} produto(s) em comum{s.previsao ? ` · entrega ${s.previsao.split('-').reverse().join('/')}` : ''}
                </Link>
                {podeVincular && <button type="button" disabled={pend} className={btnClass('primary')} onClick={() => rodar(() => vincularNotaAoPedido(s.id, compraId))}>Conferir com este pedido</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dados.vinculados.map((p) => (
        <div key={p.pedidoId} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/pedido-compra/${p.pedidoId}`} className="text-[14px] font-medium text-text hover:underline">Pedido nº {p.numero} · {p.fornecedor}</Link>
            {podeVincular && (
              <div className="flex gap-2">
                {p.etapa === 'aprovado' && <button type="button" disabled={pend} className={btnClass('outline')} onClick={() => rodar(() => vincularNotaAoPedido(p.pedidoId, compraId))}>Refazer a ligação</button>}
                <button type="button" disabled={pend} className={btnClass('outline')} onClick={() => rodar(() => desvincularNotaDoPedido(p.pedidoId, compraId))}>Desligar do pedido</button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead><tr className="border-b border-border">
                <th className={`text-left ${th}`}>Produto</th>
                <th className={`text-right ${th}`} title="O que o pedido ainda esperava, em unidade de estoque">Pedido</th>
                <th className={`text-right ${th}`}>Na nota</th>
                <th className={`text-right ${th}`} title="Entrou no estoque (nota lançada)">Recebido</th>
                <th className={`text-right ${th}`}>Preço combinado</th>
                <th className={`text-right ${th}`}>Preço na nota</th>
                <th className={`text-left ${th}`}>Conferência</th>
              </tr></thead>
              <tbody>
                {p.linhas.map((l, i) => (
                  <tr key={`${l.pedidoItemId ?? 'n'}-${l.notaItemId ?? i}`} className="border-t border-border/60">
                    <td className="px-2.5 py-2 text-text">{l.descricao}</td>
                    <td className="px-2.5 py-2 text-right num">{q(l.pedidoQtd)}</td>
                    <td className="px-2.5 py-2 text-right num">{q(l.notaQtd)}</td>
                    <td className="px-2.5 py-2 text-right num">{l.situacao === 'nao_veio' ? '—' : q(l.recebido)}</td>
                    <td className="px-2.5 py-2 text-right num">{brl(l.pedidoPreco)}</td>
                    <td className={`px-2.5 py-2 text-right num ${l.precoDiferente ? 'text-warn font-semibold' : ''}`}>
                      {brl(l.notaPreco)}{l.precoDiferente && l.difPrecoPct != null ? ` (${l.difPrecoPct > 0 ? '+' : ''}${l.difPrecoPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : ''}
                    </td>
                    <td className={`whitespace-nowrap px-2.5 py-2 font-medium ${SIT[l.situacao].cor}`}>{SIT[l.situacao].txt}{l.precoDiferente ? ' · preço diferente' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-text-muted">Quantidades e preços em unidade de estoque (nota: quantidade × fator; preço líquido do desconto do item). Recebido só conta depois de a entrada ser lançada.</p>
        </div>
      ))}
      {msg && <p className="text-[13px] text-text">{msg}</p>}
    </section>
  )
}
