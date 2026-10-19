'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, ShoppingCart } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import type { LinhaSugestao } from '@/lib/compras/sugestao-puro'
import { criarPedidosDaSugestao, salvarLeadTime } from '@/lib/actions/pedido-compra'

const q = (n: number | null | undefined, max = 3) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: max }))
const brl = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const COR: Record<LinhaSugestao['recomendacao'], string> = { imediato: 'bg-err', proximos: 'bg-warn', nao: 'bg-ok' }
const th = 'whitespace-nowrap px-2.5 py-2 text-[12px] font-semibold text-text-muted'
const td = 'whitespace-nowrap px-2.5 py-2 text-right num'

function novaChave(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

export function TabelaSugestao({ linhas, diasAnalise, diasEstimativa, base, podeCriarPedido, podeEditarLead, modo }: {
  linhas: LinhaSugestao[]; diasAnalise: number; diasEstimativa: number; base: 'consumo' | 'previsao'
  podeCriarPedido: boolean; podeEditarLead: boolean; modo: 'omie' | 'proprio'
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState<number | null>(null)
  const [sel, setSel] = useState<Record<number, boolean>>({})
  const [qtd, setQtd] = useState<Record<number, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [pend, start] = useTransition()
  const [chave] = useState(novaChave)
  const selecionaveis = useMemo(() => linhas.filter((l) => l.acao === 'comprar' && l.sugestao > 0), [linhas])
  const qtdDe = (l: LinhaSugestao) => {
    const v = Number((qtd[l.codigoProduto] ?? '').replace(',', '.'))
    return qtd[l.codigoProduto] != null && Number.isFinite(v) ? v : l.sugestao
  }
  const escolhidas = selecionaveis.filter((l) => sel[l.codigoProduto] && qtdDe(l) > 0)

  function criar() {
    setMsg(null)
    start(async () => {
      const r = await criarPedidosDaSugestao(escolhidas.map((l) => ({
        codigoProduto: l.codigoProduto, quantidade: qtdDe(l), preco: l.ultimoCusto ?? 0,
        fornecedorId: l.fornecedorId, fornecedorNome: l.fornecedorNome, fornecedorCnpj: l.fornecedorCnpj,
      })), chave)
      if ('error' in r) { setMsg(r.error); return }
      if (r.pedidos.length === 1) router.push(`/pedido-compra/${r.pedidos[0].id}`)
      else router.push(`/pedido-compra?criados=${r.pedidos.map((p) => p.numero).join(',')}`)
    })
  }

  function lead(l: LinhaSugestao, valor: string) {
    const dias = Number(valor)
    if (!Number.isInteger(dias) || dias === l.leadTime) return
    start(async () => {
      const r = await salvarLeadTime(l.codigoProduto, dias)
      if ('error' in r) setMsg(r.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {podeCriarPedido && selecionaveis.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] bg-surface px-3 py-2 shadow-[var(--shadow-sm)]">
          <button type="button" className={btnClass('outline')} onClick={() => setSel(Object.fromEntries(selecionaveis.map((l) => [l.codigoProduto, true])))}>
            Marcar os {selecionaveis.length} a comprar
          </button>
          <button type="button" className={btnClass('outline')} onClick={() => setSel({})}>Limpar</button>
          <button type="button" className={btnClass('primary')} disabled={pend || escolhidas.length === 0} onClick={criar}>
            <ShoppingCart className="size-4" /> {pend ? 'Criando…' : `Criar pedido de compra (${escolhidas.length})`}
          </button>
          <span className="text-[12px] text-text-muted">Um rascunho por fornecedor (o da última nota), com o último custo como preço. Você confere e envia para aprovação.</span>
          {msg && <span className="text-[13px] text-err">{msg}</span>}
        </div>
      )}
      {!podeCriarPedido && msg && <p className="text-[13px] text-err">{msg}</p>}

      <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              {podeCriarPedido && <th className={th} aria-label="Selecionar" />}
              <th className={`text-left ${th}`}>Recomendação</th>
              <th className={`text-left ${th}`}>Produto</th>
              <th className={`text-right ${th}`} title={`Saídas em ${diasAnalise} dias ÷ ${diasAnalise}`}>Consumo/dia</th>
              <th className={`text-right ${th}`}>Estoque atual</th>
              <th className={`text-right ${th}`}>Mínimo</th>
              <th className={`text-right ${th}`} title="Estoque atual ÷ consumo médio">Duração (dias)</th>
              <th className={`text-right ${th}`}>Lead time</th>
              <th className={`text-right ${th}`} title="Mínimo + consumo médio × lead time">Ponto de pedido</th>
              <th className={`text-right ${th}`} title="Dias até o estoque chegar no ponto de pedido">Dias até o ponto</th>
              <th className={`text-right ${th}`}>Entrada prevista</th>
              <th className={`text-right ${th}`} title={base === 'consumo' ? `Consumo médio × ${diasEstimativa} dias` : 'Previsão de venda + consumo nas OPs abertas'}>Saída projetada</th>
              <th className={`text-right ${th}`}>Sugestão</th>
              {podeCriarPedido && <th className={`text-right ${th}`}>Comprar</th>}
              <th className={`text-left ${th}`}>Fornecedor</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const sel0 = l.acao === 'comprar' && l.sugestao > 0
              const abre = aberto === l.codigoProduto
              return (
                <Fragment key={l.codigoProduto}>
                  <tr className="border-t border-border/60 align-top">
                    {podeCriarPedido && (
                      <td className="px-2.5 py-2">
                        {sel0 && <input type="checkbox" aria-label={`Comprar ${l.descricao}`} checked={!!sel[l.codigoProduto]}
                          onChange={(e) => setSel((s) => ({ ...s, [l.codigoProduto]: e.target.checked }))} />}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-2.5 py-2">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text">
                        <span className={`size-2 shrink-0 rounded-full ${COR[l.recomendacao]}`} aria-hidden />{l.rotulo}
                      </span>
                    </td>
                    <td className="min-w-[220px] px-2.5 py-2">
                      <button type="button" onClick={() => setAberto(abre ? null : l.codigoProduto)} className="flex items-start gap-1 text-left">
                        {abre ? <ChevronDown className="mt-0.5 size-3.5 shrink-0" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0" />}
                        <span>
                          <span className="block text-[13px] font-medium text-text">{l.descricao}</span>
                          <span className="num text-[11px] text-text-muted">{l.codigo} · {l.familia} · {l.unidade}</span>
                        </span>
                      </button>
                    </td>
                    <td className={td}>{q(l.consumoMedio)}</td>
                    <td className={`${td} ${l.estoqueAtual < 0 ? 'text-err' : ''}`}>{q(l.estoqueAtual)}</td>
                    <td className={td}>{q(l.estoqueMinimo)}</td>
                    <td className={`${td} ${l.duracao < 0 ? 'text-err' : ''}`}>{l.consumoMedio > 0 ? l.duracao : '—'}</td>
                    <td className={td}>
                      {podeEditarLead ? (
                        <input type="number" min={1} max={365} defaultValue={l.leadTime} disabled={pend} aria-label={`Lead time de ${l.descricao}`}
                          className="w-14 rounded-[var(--r-sm)] bg-surface-2 px-1 py-0.5 text-right text-[13px]" onBlur={(e) => lead(l, e.target.value)} />
                      ) : (
                        <span title={l.leadTimeInformado ? (modo === 'omie' ? 'Do cadastro do produto no Omie' : 'Informado') : 'Não informado: 1 dia (padrão do Omie)'}>
                          {l.leadTime}{!l.leadTimeInformado && <span className="text-text-muted">*</span>}
                        </span>
                      )}
                    </td>
                    <td className={td}>{q(l.pontoPedido)}</td>
                    <td className={td}>{l.consumoMedio > 0 ? l.diasAtePonto : '—'}</td>
                    <td className={td}>{q(l.entradaPrevista)}</td>
                    <td className={td}>{q(l.saidaProjetada)}</td>
                    <td className={`${td} font-semibold ${l.sugestao > 0 ? 'text-text' : 'text-text-muted'}`}>{q(l.sugestao)}</td>
                    {podeCriarPedido && (
                      <td className={td}>
                        {sel0 && <input inputMode="decimal" aria-label={`Quantidade a comprar de ${l.descricao}`} value={qtd[l.codigoProduto] ?? String(l.sugestao).replace('.', ',')}
                          onChange={(e) => setQtd((s) => ({ ...s, [l.codigoProduto]: e.target.value }))}
                          className="w-20 rounded-[var(--r-sm)] bg-surface-2 px-1 py-0.5 text-right text-[13px]" />}
                      </td>
                    )}
                    <td className="min-w-[160px] px-2.5 py-2 text-[12px] text-text-muted">
                      {l.fornecedorNome ?? '—'}
                      {l.ultimoCusto != null && <span className="block num">{brl(l.ultimoCusto)}/{l.unidade}{l.ultimaCompra ? ` · ${l.ultimaCompra.split('-').reverse().join('/')}` : ''}</span>}
                    </td>
                  </tr>
                  {abre && (
                    <tr className="bg-surface-2/60">
                      <td colSpan={podeCriarPedido ? 15 : 13} className="px-4 py-3 text-[12.5px] text-text">
                        <div className="grid gap-1 sm:grid-cols-2">
                          <span>Consumo médio = {q(l.consumoTotal)} ÷ {diasAnalise} dias = <b className="num">{q(l.consumoMedio, 6)}</b></span>
                          <span>Ponto de pedido = {q(l.estoqueMinimo)} + ({q(l.consumoMedio, 6)} × {l.leadTime}) = <b className="num">{q(l.pontoPedido, 6)}</b></span>
                          <span>
                            Saída projetada = {base === 'consumo' || (l.previsaoVenda == null && l.consumoOps === 0)
                              ? `${q(l.consumoMedio, 6)} × ${diasEstimativa} dias`
                              : `previsão de venda ${q(l.previsaoVenda ?? 0)} + consumo nas OPs abertas ${q(l.consumoOps)}`} = <b className="num">{q(l.saidaProjetada, 6)}</b>
                          </span>
                          <span>Entrada prevista = notas a receber {q(l.entradaNf)} + OPs abertas {q(l.entradaOps)} + pedidos {q(l.entradaPedidos)} = <b className="num">{q(l.entradaPrevista)}</b></span>
                          <span>Sugestão = ({q(l.saidaProjetada, 6)} + {q(l.pontoPedido, 6)}) − ({q(l.estoqueAtual)} + {q(l.entradaPrevista)}) = <b className="num">{q(l.sugestao, 6)}</b></span>
                          <span>Dias até o ponto = ({q(l.estoqueAtual)} − {q(l.pontoPedido, 6)}) ÷ {q(l.consumoMedio, 6)} = <b className="num">{l.diasAtePonto}</b></span>
                          {base === 'consumo' && l.previsaoVenda != null && <span className="text-text-muted">Previsão de venda no período (não usada nesta base): {q(l.previsaoVenda)}</span>}
                          <span className="text-text-muted">Custo médio {brl(l.custoMedio)} · último custo {brl(l.ultimoCusto)} · valor estimado {brl(l.valorEstimado)}</span>
                          {l.consumoOps > 0 && base === 'consumo' && <span className="text-text-muted">Consumo previsto nas OPs abertas (não usado nesta base): {q(l.consumoOps)}</span>}
                        </div>
                        <Link href={`/estoque/produto/${l.codigoProduto}`} className="mt-2 inline-block text-[12px] font-semibold text-brand">Abrir o produto</Link>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
