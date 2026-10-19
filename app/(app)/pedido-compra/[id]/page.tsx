import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { AcoesPedido } from '@/components/compras/AcoesPedido'
import { acoesDisponiveis, parcelasDoPedido } from '@/lib/compras/pedido-puro'
import { FUNDO_CLASSE } from '@/lib/status-cor'
import { carregarPedido } from '../dados'
import { nomesCompradores } from '../cadastros'
import { TOM_COR } from '../tom'
import { HistoricoAlteracoes } from '@/components/historico/HistoricoAlteracoes'

const q = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
const dataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const th = 'whitespace-nowrap px-3 py-2 text-[12px] font-semibold text-text-muted'
const EVENTO: Record<string, string> = {
  criado: 'Criado', editado: 'Editado', enviar: 'Enviado para aprovação', aprovar: 'Aprovado', reprovar: 'Devolvido ao comprador', reabrir: 'Reaberto',
  cancelar: 'Cancelado', nota_vinculada: 'Nota vinculada', nota_desvinculada: 'Nota desvinculada',
}

export default async function PedidoCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const podeEditar = await requirePermissao(lojaId, 'Compras - Pedidos')
  const podeAprovar = await requirePermissao(lojaId, 'Compras - Aprovar pedidos')
  if (!podeEditar && !podeAprovar) notFound()
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const p = await carregarPedido(lojaId, Number(id))
  if (!p) notFound()
  const { cab, resumo, itens } = p
  const compradorNome = resumo.compradorId ? (await nomesCompradores(lojaId)).get(resumo.compradorId) ?? null : null
  const recebidoTotal = itens.length > 0 && itens.every((i) => i.recebido + 1e-6 >= i.quantidadeBase)
  const acoes = acoesDisponiveis(cab.etapa, { temVinculo: p.notas.length > 0, podeAprovar, podeEditar, recebidoTotal })
  const parcelas = parcelasDoPedido(Array.isArray(cab.parcelas) ? cab.parcelas : [], resumo.total, cab.previsao_entrega)
  const pct = resumo.qtdBase > 0 ? Math.min(100, (resumo.recebido / resumo.qtdBase) * 100) : 0

  return (
    <div className="space-y-4">
      <DetailHeader href="/pedido-compra" title={`Pedido de compra nº ${cab.numero}`}
        breadcrumb={[{ label: 'Pedidos de compra', href: '/pedido-compra' }, { label: `Nº ${cab.numero}` }]}
        meta={
          <div className="space-y-2">
            <p className="text-[15px] text-text-muted">{cab.fornecedor_nome}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-muted">
              <span className="inline-flex items-center gap-1.5 font-medium text-text">
                <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[TOM_COR[resumo.etapaExibida.tom]]}`} aria-hidden />{resumo.etapaExibida.rotulo}
              </span>
              <span>Criado {dataHora(cab.created_at)}{cab.criado_por_nome ? ` por ${cab.criado_por_nome}` : ''}{cab.origem === 'sugestao' ? ' (da sugestão de compra)' : cab.origem === 'requisicao' ? ' (das requisições)' : cab.origem === 'planilha' ? ' (da planilha)' : ''}</span>
              {compradorNome && <span>Comprador: <span className="text-text">{compradorNome}</span></span>}
              {cab.aprovado_em && <span>Aprovado {dataHora(cab.aprovado_em)}{cab.aprovado_por_nome ? ` por ${cab.aprovado_por_nome}` : ''}</span>}
              {cab.cancelado_em && <span className="text-err">Cancelado {dataHora(cab.cancelado_em)}{cab.motivo_cancelamento ? `: ${cab.motivo_cancelamento}` : ''}</span>}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <a href={`/pedido-compra/${cab.id}/pdf`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}><FileText className="size-4" /> PDF para o fornecedor</a>
            </div>
            <AcoesPedido id={cab.id} acoes={acoes} recebeuAlgo={resumo.recebido > 0} />
          </div>
        } />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card titulo="Total do pedido" valor={<Money value={resumo.total} />} sub={`Mercadorias ${resumo.valorItens.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`} />
        <Card titulo="Recebido" valor={`${pct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`} sub="em quantidade, notas já lançadas no estoque" />
        <Card titulo="Previsão de entrega" valor={dataBR(cab.previsao_entrega)} sub={cab.numero_fornecedor ? `Pedido no fornecedor: ${cab.numero_fornecedor}` : undefined} />
        <Card titulo="Pagamento" valor={parcelas.length ? `${parcelas.length}x` : 'À vista'} sub={parcelas.length ? parcelas.map((x) => `${x.dias}d`).join('/') : undefined} />
      </div>

      <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b border-border">
            <th className={`text-left ${th}`}>Item</th><th className={`text-left ${th}`}>Produto</th><th className={`text-right ${th}`}>Quantidade</th>
            <th className={`text-right ${th}`}>Preço combinado</th><th className={`text-right ${th}`}>Total</th><th className={`text-left ${th}`}>Local</th>
            <th className={`text-right ${th}`} title="Em unidade de estoque">Em nota</th><th className={`text-right ${th}`} title="Em unidade de estoque, notas lançadas">Recebido</th>
            <th className={`text-right ${th}`}>Falta</th>
          </tr></thead>
          <tbody>
            {itens.map((i) => {
              const falta = Math.max(0, i.quantidadeBase - i.recebido)
              return (
                <tr key={i.id} className="border-t border-border/60">
                  <td className="px-3 py-2 num text-text-muted">{i.linha}</td>
                  <td className="min-w-[220px] px-3 py-2">
                    <Link href={`/estoque/produto/${i.codigoProduto}`} className="text-[13px] font-medium text-text hover:underline">{i.descricao}</Link>
                    <span className="block num text-[11px] text-text-muted">{p.codigos.get(i.codigoProduto) ?? i.codigoProduto}{i.fator !== 1 ? ` · 1 ${i.unidade} = ${q(i.fator)} un. de estoque` : ''}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right num">{q(i.quantidade)} {i.unidade}</td>
                  <td className="px-3 py-2 text-right"><Money value={i.precoUnitario} /></td>
                  <td className="px-3 py-2 text-right"><Money value={i.quantidade * i.precoUnitario} /></td>
                  <td className="px-3 py-2 text-[12px] text-text-muted">{i.codigoLocal ? p.locais.get(i.codigoLocal) ?? i.codigoLocal : 'Padrão da nota'}</td>
                  <td className="px-3 py-2 text-right num">{q(i.vinculado)}</td>
                  <td className={`px-3 py-2 text-right num ${i.recebido > i.quantidadeBase + 1e-6 ? 'text-warn' : ''}`}>{q(i.recebido)}</td>
                  <td className={`px-3 py-2 text-right num ${falta > 0 && cab.etapa === 'aprovado' ? 'text-warn' : 'text-text-muted'}`}>{q(falta)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
        <h2 className="text-[15px] font-semibold text-text">Notas do fornecedor</h2>
        {p.notas.length === 0 ? (
          <p className="text-[13px] text-text-muted">{cab.etapa === 'aprovado' ? 'Nenhuma nota ainda. Ao abrir a nota do fornecedor em Notas Fiscais, ela sugere este pedido para conferir.' : 'Só pedido aprovado recebe nota.'}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {p.notas.map((n) => (
              <li key={n.compraId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <span>NF {n.numero ?? '—'} · emissão {dataBR(n.emissao)} · {n.itens} item(ns) ligados · <span className="text-text-muted">{n.status === 'lancada' ? 'lançada no estoque' : n.status === 'parcial' ? 'lançada em parte' : n.status === 'cancelada' ? 'cancelada' : 'ainda não lançada'}</span></span>
                {n.notaId && <Link href={`/nota-fiscal/${n.notaId}`} className="font-semibold text-brand">Conferir pedido × nota × recebido</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(cab.obs || cab.obs_interna || parcelas.length > 0) && (
        <section className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] shadow-[var(--shadow-sm)] sm:grid-cols-3">
          {parcelas.length > 0 && <div><h3 className="mb-1 font-semibold text-text">Parcelas</h3>{parcelas.map((x) => <p key={x.numero} className="num">{x.numero}ª · {x.vencimento ? dataBR(x.vencimento) : `+${x.dias} dias`} · <Money value={x.valor} /></p>)}</div>}
          {cab.obs && <div><h3 className="mb-1 font-semibold text-text">Observações (vão no PDF)</h3><p className="whitespace-pre-wrap text-text-muted">{cab.obs}</p></div>}
          {cab.obs_interna && <div><h3 className="mb-1 font-semibold text-text">Observações internas</h3><p className="whitespace-pre-wrap text-text-muted">{cab.obs_interna}</p></div>}
        </section>
      )}

      <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
        <h2 className="mb-2 text-[15px] font-semibold text-text">Histórico</h2>
        <ul className="space-y-1 text-[13px]">
          {p.eventos.map((e) => (
            <li key={e.id} className="text-text-muted">
              <span className="num">{dataHora(e.em)}</span> · <span className="text-text">{EVENTO[e.tipo] ?? e.tipo}</span>{e.userNome ? ` · ${e.userNome}` : ''}
              {typeof e.detalhe.motivo === 'string' ? ` · "${e.detalhe.motivo}"` : ''}
              {e.tipo === 'nota_vinculada' ? ` · NF ${String(e.detalhe.numero ?? '')}: ${String(e.detalhe.itens ?? 0)} item(ns)${Number(e.detalhe.fora_do_pedido) ? `, ${String(e.detalhe.fora_do_pedido)} fora do pedido` : ''}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <HistoricoAlteracoes lojaId={lojaId} entidade="pedido_compra" ids={[cab.id]} titulo="Alterações campo a campo" />
    </div>
  )
}
