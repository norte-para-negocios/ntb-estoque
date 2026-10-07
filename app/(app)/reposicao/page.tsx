import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BellRing, Download, PackageCheck, Wallet } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { Toolbar } from '@/components/ui-kit/Toolbar'
import { BarraSaldo, fmtBRL, fmtQtd, Indicador } from '@/components/estoque-proprio/Apresentacao'
import { carregarReposicao, filtrarReposicao, type FiltroReposicao } from './dados'

const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40'
const rotulo = 'mb-1 block text-[11px] font-medium text-text-muted'

export default async function ReposicaoPage({ searchParams }: { searchParams: Promise<FiltroReposicao> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const sp = await searchParams
  const { linhas, locais, familias } = await carregarReposicao(lojaId)
  const filtradas = filtrarReposicao(linhas, sp)

  const porFamilia = new Map<string, typeof filtradas>()
  for (const l of filtradas) porFamilia.set(l.familia, [...(porFamilia.get(l.familia) ?? []), l])
  const grupos = [...porFamilia.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  const valorTotal = filtradas.reduce((a, l) => a + l.valorEstimado, 0)
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Reposição" description="O que está abaixo do mínimo e quanto falta para chegar nele"
          actions={filtradas.length ? <a href={`/reposicao/csv${qs ? `?${qs}` : ''}`} className={btnClass('outline')}><Download className="size-4" />Baixar CSV</a> : undefined} />
      </ListaHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Indicador icon={BellRing} rotulo="Itens abaixo do mínimo" valor={String(filtradas.length)} tom={filtradas.length ? 'aviso' : undefined} dica={`${grupos.length} família${grupos.length === 1 ? '' : 's'}`} />
        <Indicador icon={Wallet} rotulo="Compra estimada" valor={fmtBRL(valorTotal)} dica="falta × último custo (ou custo médio)" />
        <Indicador icon={PackageCheck} rotulo="Mínimos definidos" valor="no produto" dica="defina o mínimo por local em Estoque" />
      </div>

      <Toolbar>
        <form method="get" className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
          <div><label className={rotulo} htmlFor="r-q">Buscar produto</label><input id="r-q" name="q" defaultValue={sp.q ?? ''} placeholder="Nome ou código" className={campo} /></div>
          <div><label className={rotulo} htmlFor="r-f">Família</label>
            <select id="r-f" name="familia" defaultValue={sp.familia ?? ''} className={campo}><option value="">Todas</option>{familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.nome}</option>)}</select></div>
          <div><label className={rotulo} htmlFor="r-l">Local</label>
            <select id="r-l" name="local" defaultValue={sp.local ?? ''} className={campo}><option value="">Todos</option>{locais.map((l) => <option key={l.codigoLocal} value={l.codigoLocal}>{l.descricao}</option>)}</select></div>
          <div className="flex gap-2"><button type="submit" className={btnClass('primary')}>Filtrar</button><Link href="/reposicao" className={btnClass('outline')}>Limpar</Link></div>
        </form>
      </Toolbar>

      {grupos.length === 0 && (
        <EmptyState icon={PackageCheck} title={linhas.length ? 'Nada neste filtro' : 'Tudo em dia'} hint={linhas.length ? 'Ajuste os filtros.' : 'Nenhum item está abaixo do mínimo. Defina o mínimo de cada produto, por local, na tela de Estoque.'} />
      )}

      {grupos.map(([familia, itens]) => (
        <section key={familia} className="overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[15px] font-semibold text-text">{familia}</h2>
            <span className="num text-[13px] text-text-muted">{itens.length} item(ns) · {fmtBRL(itens.reduce((a, l) => a + l.valorEstimado, 0))}</span>
          </header>
          <ul className="divide-y divide-[var(--border)]">
            {itens.map((l) => (
              <li key={`${l.codigoProduto}-${l.codigoLocal}`} className="grid items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <Link href={`/estoque/produto/${l.codigoProduto}`} className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-text hover:underline">{l.descricao}</span>
                  <span className="num text-[12px] text-text-muted">{l.codigo} · {l.local}</span>
                </Link>
                <div>
                  <span className="num text-[13px]">{fmtQtd(l.saldo)} <span className="text-text-muted">de {fmtQtd(l.minimo)} {l.unidade}</span></span>
                  <div className="mt-1"><BarraSaldo saldo={l.saldo} minimo={l.minimo} situacao={l.saldo < 0 ? 'negativo' : l.saldo === 0 ? 'zerado' : 'baixo'} /></div>
                </div>
                <div className="md:text-right"><div className="text-[11px] text-text-muted">Comprar</div><div className="num text-[15px] font-semibold text-warn">{fmtQtd(l.falta)} <span className="text-[12px] font-normal text-text-muted">{l.unidade}</span></div></div>
                <div className="md:text-right"><div className="text-[11px] text-text-muted">Estimativa</div><div className="num text-[14px]">{l.valorEstimado ? fmtBRL(l.valorEstimado) : '—'}</div></div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
