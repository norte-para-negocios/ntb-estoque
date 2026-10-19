import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { Money } from '@/components/ui-kit/Money'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { AcoesRequisicao } from '@/components/compras/AcoesRequisicao'
import { acoesRequisicao, previaGerarPedidos, rotuloEtapaRequisicao } from '@/lib/compras/requisicao-puro'
import { FUNDO_CLASSE } from '@/lib/status-cor'
import { nomesCompradores } from '../../pedido-compra/cadastros'
import { TOM_COR } from '../../pedido-compra/tom'
import { carregarRequisicao } from '../dados'

const q = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
const dataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })
const th = 'whitespace-nowrap px-3 py-2 text-[12px] font-semibold text-text-muted'
const EVENTO: Record<string, string> = {
  criada: 'Criada', editada: 'Editada', aprovar: 'Aprovada', recusar: 'Recusada', reabrir: 'Reaberta', pedido_gerado: 'Virou pedido de compra',
}

export default async function RequisicaoPage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const [podeEditar, podeAprovar, podeGerar] = await Promise.all([
    requirePermissao(lojaId, 'Compras - Requisicoes'), requirePermissao(lojaId, 'Compras - Aprovar pedidos'), requirePermissao(lojaId, 'Compras - Pedidos'),
  ])
  if (!podeEditar && !podeAprovar && !podeGerar) notFound()
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const d = await carregarRequisicao(lojaId, Number(id))
  if (!d) notFound()
  const { req } = d
  const et = rotuloEtapaRequisicao(req.etapa)
  const comprador = req.compradorId ? (await nomesCompradores(lojaId)).get(req.compradorId) ?? null : null
  const previa = req.etapa === 'aprovada' ? previaGerarPedidos(req.itens.map((i) => ({ ...i, requisicaoNumero: req.numero }))) : []

  return (
    <div className="space-y-4">
      <DetailHeader href="/requisicao-compra" title={`Requisição de compra nº ${req.numero}`}
        breadcrumb={[{ label: 'Requisições de compra', href: '/requisicao-compra' }, { label: `Nº ${req.numero}` }]}
        meta={
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-muted">
              <span className="inline-flex items-center gap-1.5 font-medium text-text">
                <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[TOM_COR[et.tom]]}`} aria-hidden />{et.rotulo}
              </span>
              <span>Criada {dataHora(req.createdAt)}{req.criadoPorNome ? ` por ${req.criadoPorNome}` : ''}{req.origem === 'sugestao' ? ' (da sugestão de compra)' : ''}</span>
              {comprador && <span>Comprador: <span className="text-text">{comprador}</span></span>}
              {req.aprovadoEm && <span>Aprovada {dataHora(req.aprovadoEm)}{req.aprovadoPorNome ? ` por ${req.aprovadoPorNome}` : ''}</span>}
              {req.recusadoEm && <span className="text-err">Recusada {dataHora(req.recusadoEm)}{req.motivoRecusa ? `: ${req.motivoRecusa}` : ''}</span>}
            </div>
            <AcoesRequisicao id={req.id} acoes={acoesRequisicao(req.etapa, { podeEditar, podeAprovar })} podeGerarPedido={podeGerar && req.etapa === 'aprovada'} />
          </div>
        } />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card titulo="Valor pelo preço sugerido" valor={<Money value={req.valor} />} sub={`${req.itens.length} item(ns)`} />
        <Card titulo="Sugestão de entrega" valor={dataBR(req.sugestaoEntrega)} />
        <Card titulo={req.etapa === 'pedido' ? 'Pedidos gerados' : 'Vai virar'} valor={req.etapa === 'pedido' ? String(d.pedidos.length) : previa.length ? `${previa.length} pedido(s)` : '—'}
          sub={req.etapa === 'pedido' ? undefined : previa.length ? 'um por fornecedor sugerido' : 'só depois de aprovada'} />
      </div>

      <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b border-border">
            <th className={`text-left ${th}`}>Item</th><th className={`text-left ${th}`}>Produto</th><th className={`text-right ${th}`}>Quantidade</th>
            <th className={`text-right ${th}`}>Preço sugerido</th><th className={`text-right ${th}`}>Total</th><th className={`text-left ${th}`}>Fornecedor sugerido</th>
          </tr></thead>
          <tbody>
            {req.itens.map((i) => (
              <tr key={i.id} className="border-t border-border/60">
                <td className="px-3 py-2 num text-text-muted">{i.linha}</td>
                <td className="min-w-[220px] px-3 py-2">
                  <Link href={`/estoque/produto/${i.codigoProduto}`} className="text-[13px] font-medium text-text hover:underline">{i.descricao}</Link>
                  <span className="block num text-[11px] text-text-muted">{d.codigos.get(i.codigoProduto) ?? i.codigoProduto}{i.fator !== 1 ? ` · 1 ${i.unidade} = ${q(i.fator)} un. de estoque` : ''}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right num">{q(i.quantidade)} {i.unidade}</td>
                <td className="px-3 py-2 text-right"><Money value={i.precoSugerido} /></td>
                <td className="px-3 py-2 text-right"><Money value={i.quantidade * i.precoSugerido} /></td>
                <td className="px-3 py-2 text-[12px] text-text-muted">{i.fornecedorNome ?? 'A definir'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d.pedidos.length > 0 && (
        <section className="space-y-1 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] shadow-[var(--shadow-sm)]">
          <h2 className="text-[15px] font-semibold text-text">Pedidos de compra</h2>
          {d.pedidos.map((p) => <p key={p.id}><Link href={`/pedido-compra/${p.id}`} className="font-semibold text-brand">Pedido nº {p.numero}</Link> · {p.fornecedor}</p>)}
        </section>
      )}

      {(req.obs || req.obsInterna) && (
        <section className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] shadow-[var(--shadow-sm)] sm:grid-cols-2">
          {req.obs && <div><h3 className="mb-1 font-semibold text-text">Observações</h3><p className="whitespace-pre-wrap text-text-muted">{req.obs}</p></div>}
          {req.obsInterna && <div><h3 className="mb-1 font-semibold text-text">Observações internas</h3><p className="whitespace-pre-wrap text-text-muted">{req.obsInterna}</p></div>}
        </section>
      )}

      <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
        <h2 className="mb-2 text-[15px] font-semibold text-text">Histórico</h2>
        <ul className="space-y-1 text-[13px]">
          {d.eventos.map((e) => (
            <li key={e.id} className="text-text-muted">
              <span className="num">{dataHora(e.em)}</span> · <span className="text-text">{EVENTO[e.tipo] ?? e.tipo}</span>{e.userNome ? ` · ${e.userNome}` : ''}
              {typeof e.detalhe.motivo === 'string' ? ` · "${e.detalhe.motivo}"` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
