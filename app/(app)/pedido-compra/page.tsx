import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClipboardCheck, Plus } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { ETAPAS_FILTRO } from '@/lib/compras/pedido-puro'
import { FUNDO_CLASSE } from '@/lib/status-cor'
import { listarPedidos } from './dados'
import { TOM_COR } from './tom'

type Sp = Record<string, string | undefined>
const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40'
const rotulo = 'mb-1 block text-[11px] font-medium text-text-muted'
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

export default async function PedidosCompraPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Pedidos')) && !(await requirePermissao(lojaId, 'Compras - Aprovar pedidos'))) notFound()
  const podeCriar = await requirePermissao(lojaId, 'Compras - Pedidos')
  const sp = await searchParams
  const { pedidos, erro } = await listarPedidos(lojaId)
  const q = semAcento((sp.q ?? '').trim())
  const vis = pedidos.filter((p) => (!sp.etapa || (sp.etapa === 'abertos' ? ['aguardando_aprovacao', 'aprovado', 'recebido_parcial'].includes(p.etapaExibida.chave) : p.etapaExibida.chave === sp.etapa))
    && (!q || semAcento(p.fornecedorNome).includes(q) || String(p.numero) === q))
  const aguardando = pedidos.filter((p) => p.etapa === 'aguardando_aprovacao')
  const abertos = pedidos.filter((p) => p.etapaExibida.chave === 'aprovado' || p.etapaExibida.chave === 'recebido_parcial')
  const valorAberto = abertos.reduce((a, p) => a + (p.qtdBase > 0 ? p.valorItens * Math.max(0, 1 - p.recebido / p.qtdBase) : 0), 0)
  const criados = (sp.criados ?? '').split(',').filter((x) => /^\d+$/.test(x))

  return (
    <div className="space-y-4">
      <PageHeader title="Pedidos de compra" icon={ClipboardCheck} description="Pedido ao fornecedor com preço combinado, aprovação e conferência com a nota que chegar."
        actions={<>
          <Link href="/sugestao-compra" className={btnClass('outline')}>Sugestão de compra</Link>
          <Link href="/requisicao-compra" className={btnClass('outline')}>Requisições</Link>
          {podeCriar && <Link href="/pedido-compra/importar" className={btnClass('outline')}>Importar planilha</Link>}
          {podeCriar && <Link href="/pedido-compra/novo" className={btnClass('primary')}><Plus className="size-4" /> Novo pedido</Link>}
        </>} />

      {criados.length > 0 && (
        <p className="rounded-[var(--r-lg)] bg-ok/10 px-4 py-3 text-[13px] text-text">
          {criados.length === 1 ? 'Rascunho criado' : `${criados.length} rascunhos criados (um por fornecedor)`}: nº {criados.join(', ')}. Confira os preços e envie para aprovação.
        </p>
      )}
      {erro && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{erro}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card titulo="Aguardando aprovação" valor={aguardando.length.toLocaleString('pt-BR')} sub={aguardando.length ? `${aguardando.reduce((a, p) => a + p.total, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : undefined} />
        <Card titulo="Aprovados a receber" valor={abertos.length.toLocaleString('pt-BR')} sub="aprovado ou recebido em parte" />
        <Card titulo="Valor a receber" valor={<Money value={valorAberto} />} sub="itens ainda não recebidos" />
        <Card titulo="Pedidos" valor={pedidos.length.toLocaleString('pt-BR')} sub={pedidos.length >= 300 ? 'os 300 mais recentes' : undefined} />
      </div>

      <form method="get" className="grid grid-cols-1 items-end gap-3 rounded-[var(--r-lg)] bg-surface p-3 shadow-[var(--shadow-sm)] sm:grid-cols-[2fr_1fr_auto]">
        <div><label className={rotulo} htmlFor="p-q">Fornecedor ou número</label><input id="p-q" name="q" defaultValue={sp.q ?? ''} className={campo} /></div>
        <div><label className={rotulo} htmlFor="p-e">Etapa</label>
          <select id="p-e" name="etapa" defaultValue={sp.etapa ?? ''} className={campo}>
            <option value="">Todas</option><option value="abertos">Em aberto</option>
            {ETAPAS_FILTRO.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select></div>
        <div className="flex gap-2"><button type="submit" className={btnClass('primary')}>Filtrar</button><Link href="/pedido-compra" className={btnClass('outline')}>Limpar</Link></div>
      </form>

      {vis.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={pedidos.length ? 'Nenhum pedido neste filtro' : 'Nenhum pedido de compra ainda'}
          hint={pedidos.length ? 'Ajuste o filtro.' : 'Crie um pedido aqui ou marque os itens na Sugestão de compra.'} />
      ) : (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
          {vis.map((p) => (
            <li key={p.id}>
              <Link href={`/pedido-compra/${p.id}`} className="grid items-center gap-x-4 gap-y-1 px-4 py-3 u-motion hover:bg-surface-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-text">Nº {p.numero} · {p.fornecedorNome}</span>
                  <span className="text-[12px] text-text-muted">{p.itens} item(ns) · criado {dataBR(p.createdAt)}{p.criadoPorNome ? ` por ${p.criadoPorNome}` : ''}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text">
                  <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[TOM_COR[p.etapaExibida.tom]]}`} aria-hidden />{p.etapaExibida.rotulo}
                </span>
                <span className="text-[13px] text-text-muted">Entrega: <span className="num text-text">{dataBR(p.previsaoEntrega)}</span></span>
                <span className="md:text-right"><Money value={p.total} className="text-[14px] font-semibold" /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
