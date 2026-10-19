import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClipboardList, Plus } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { ListaRequisicoes } from '@/components/compras/ListaRequisicoes'
import { ETAPAS_REQUISICAO } from '@/lib/compras/requisicao-puro'
import { nomesCompradores } from '../pedido-compra/cadastros'
import { listarRequisicoes } from './dados'

type Sp = Record<string, string | undefined>
const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40'
const rotulo = 'mb-1 block text-[11px] font-medium text-text-muted'
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default async function RequisicoesCompraPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const [podeCriar, podeAprovar, podeGerar] = await Promise.all([
    requirePermissao(lojaId, 'Compras - Requisicoes'), requirePermissao(lojaId, 'Compras - Aprovar pedidos'), requirePermissao(lojaId, 'Compras - Pedidos'),
  ])
  if (!podeCriar && !podeAprovar && !podeGerar) notFound()
  const sp = await searchParams
  const [{ requisicoes, erro }, compradores] = await Promise.all([listarRequisicoes(lojaId), nomesCompradores(lojaId)])
  const q = semAcento((sp.q ?? '').trim())
  const vis = requisicoes.filter((r) => (!sp.etapa || (sp.etapa === 'abertas' ? r.etapa === 'aberta' || r.etapa === 'aprovada' : r.etapa === sp.etapa))
    && (!q || String(r.numero) === q || r.itens.some((i) => semAcento(i.descricao).includes(q) || semAcento(i.fornecedorNome ?? '').includes(q))))
  const abertas = requisicoes.filter((r) => r.etapa === 'aberta')
  const aprovadas = requisicoes.filter((r) => r.etapa === 'aprovada')

  return (
    <div className="space-y-4">
      <PageHeader title="Requisições de compra" icon={ClipboardList}
        description="O pedido interno de compra: quem precisa pede, o gestor aprova e as aprovadas viram pedido ao fornecedor."
        actions={<>
          <Link href="/pedido-compra" className={btnClass('outline')}>Pedidos de compra</Link>
          {podeCriar && <Link href="/requisicao-compra/novo" className={btnClass('primary')}><Plus className="size-4" /> Nova requisição</Link>}
        </>} />
      {erro && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{erro}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card titulo="Para aprovar" valor={abertas.length.toLocaleString('pt-BR')} sub={abertas.length ? abertas.reduce((a, r) => a + r.valor, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : undefined} />
        <Card titulo="Aprovadas sem pedido" valor={aprovadas.length.toLocaleString('pt-BR')} sub={aprovadas.length ? 'marque e gere o pedido' : undefined} />
        <Card titulo="Valor aprovado a pedir" valor={<Money value={aprovadas.reduce((a, r) => a + r.valor, 0)} />} sub="pelo preço sugerido" />
      </div>

      <form method="get" className="grid grid-cols-1 items-end gap-3 rounded-[var(--r-lg)] bg-surface p-3 shadow-[var(--shadow-sm)] sm:grid-cols-[2fr_1fr_auto]">
        <div><label className={rotulo} htmlFor="r-q">Produto, fornecedor ou número</label><input id="r-q" name="q" defaultValue={sp.q ?? ''} className={campo} /></div>
        <div><label className={rotulo} htmlFor="r-e">Etapa</label>
          <select id="r-e" name="etapa" defaultValue={sp.etapa ?? ''} className={campo}>
            <option value="">Todas</option><option value="abertas">Em andamento</option>
            {ETAPAS_REQUISICAO.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select></div>
        <div className="flex gap-2"><button type="submit" className={btnClass('primary')}>Filtrar</button><Link href="/requisicao-compra" className={btnClass('outline')}>Limpar</Link></div>
      </form>

      {vis.length === 0 ? (
        <EmptyState icon={ClipboardList} title={requisicoes.length ? 'Nenhuma requisição neste filtro' : 'Nenhuma requisição ainda'}
          hint={requisicoes.length ? 'Ajuste o filtro.' : 'Crie uma aqui ou marque os itens na Sugestão de compra e use "Criar requisição".'} />
      ) : (
        <ListaRequisicoes requisicoes={vis} compradores={Object.fromEntries(compradores)} podeGerar={podeGerar} />
      )}
    </div>
  )
}
