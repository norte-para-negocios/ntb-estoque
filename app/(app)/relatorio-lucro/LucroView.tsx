import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { Download, TrendingUp, AlertTriangle, Search } from 'lucide-react'
import { DIMS_LUCRO, type OrdemLucro, type LinhaLucro, type FiltroLucro } from './dados'
import { EvolucaoDiaria } from './EvolucaoDiaria'

const moeda = (v: number | null) => (v == null ? '-' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const pct = (v: number | null) => (v == null ? '-' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const KPI = 'flex flex-col rounded-[var(--r-lg)] bg-surface px-4 py-3 shadow-[var(--shadow-sm)]'
const KPI_NUM = 'num mt-1 block text-[22px] font-semibold leading-none tracking-[-0.02em]'

export type DadosLucro = {
  erro: string | null; linhas: LinhaLucro[]; evolucao: LinhaLucro[]
  totais: { faturamento: number; cmv: number; lucro: number; margem: number | null; vendas: number; ticket: number | null; semBaixa: number; semCusto: number }
}

export function LucroView({ f, d }: { f: FiltroLucro; d: DadosLucro }) {
  const t = d.totais
  const base = new URLSearchParams()
  base.set('data_inicio', f.ini); base.set('data_final', f.fim); base.set('dim', f.dim)
  if (f.q) base.set('q', f.q)
  const linkOrdem = (o: OrdemLucro) => {
    const p = new URLSearchParams(base)
    p.set('ordem', o); p.set('sentido', f.ordem === o && f.desc ? 'asc' : 'desc')
    return `/relatorio-lucro?${p.toString()}`
  }
  const Th = ({ o, children, esq, extra = '' }: { o: OrdemLucro; children: React.ReactNode; esq?: boolean; extra?: string }) => (
    <th scope="col" className={`px-2 py-2 sm:px-3 text-[12px] font-semibold text-text-muted ${esq ? 'text-left' : 'text-right'} ${extra}`}>
      <Link href={linkOrdem(o)} className="inline-flex items-center gap-1 hover:text-text">
        {children}{f.ordem === o ? <span aria-hidden>{f.desc ? '↓' : '↑'}</span> : null}
      </Link>
    </th>
  )
  const exportHref = `/relatorio-lucro/export?${base.toString()}`

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lucro"
        description="Faturamento menos o custo das mercadorias vendidas, pelo custo de cada baixa do estoque."
        voltarHref="/relatorios"
        actions={<a href={exportHref} className={btnClass('outline')}><Download className="size-4" /> Exportar Excel</a>}
      />

      <div className="flex flex-col gap-3">
        <ChipsPeriodo basePath="/relatorio-lucro" opcoes={chipsPeriodoPadrao({ value: '', label: 'Este mês', dataIni: f.ini, dataFim: f.fim })} />
        <form method="get" action="/relatorio-lucro" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="dim" value={f.dim} />
          <label className="flex flex-col gap-1 text-[12px] font-medium text-text-muted">De
            <input type="date" name="data_inicio" defaultValue={f.ini} className="h-10 rounded-[var(--r-md)] border border-[var(--border)] bg-surface px-3 text-[14px] text-text" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-text-muted">Até
            <input type="date" name="data_final" defaultValue={f.fim} className="h-10 rounded-[var(--r-md)] border border-[var(--border)] bg-surface px-3 text-[14px] text-text" />
          </label>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[12px] font-medium text-text-muted">Buscar
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
              <input type="search" name="q" defaultValue={f.q} placeholder="Produto, família ou tipo" className="h-10 w-full rounded-[var(--r-md)] border border-[var(--border)] bg-surface pl-9 pr-3 text-[14px] text-text" />
            </span>
          </label>
          <button type="submit" className={btnClass('primary')}>Aplicar</button>
        </form>
        <SegmentLinks basePath="/relatorio-lucro" param="dim" aria-label="Agrupar por" opcoes={DIMS_LUCRO.map((x) => ({ value: x.value === 'produto' ? '' : x.value, label: x.label }))} />
      </div>

      {d.erro && <div role="alert" className="rounded-[var(--r-md)] bg-err/10 px-4 py-3 text-[13px] text-err">Não foi possível calcular o lucro: {d.erro}</div>}

      <section aria-label="Resumo" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className={KPI}><span className="text-[13px] text-text-muted">Faturamento</span><span className={KPI_NUM}>{moeda(t.faturamento)}</span></div>
        <div className={KPI}><span className="text-[13px] text-text-muted">Custo (CMV)</span><span className={KPI_NUM}>{moeda(t.cmv)}</span></div>
        <div className={KPI}><span className="text-[13px] text-text-muted">Lucro</span><span className={`${KPI_NUM} ${t.lucro < 0 ? 'text-err' : 'text-text'}`}>{moeda(t.lucro)}</span></div>
        <div className={KPI}><span className="text-[13px] text-text-muted">Margem</span><span className={`${KPI_NUM} ${t.margem != null && t.margem < 0 ? 'text-err' : 'text-text'}`}>{pct(t.margem)}</span></div>
        <div className={KPI}><span className="text-[13px] text-text-muted">Ticket médio</span><span className={KPI_NUM}>{moeda(t.ticket)}</span><span className="mt-1 text-[12px] text-text-muted">{t.vendas.toLocaleString('pt-BR')} vendas</span></div>
      </section>

      {(t.semBaixa > 0 || t.semCusto > 0) && (
        <div role="note" className="flex items-start gap-3 rounded-[var(--r-md)] bg-warn/10 px-4 py-3 text-[13px] text-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
          <p>
            {t.semBaixa > 0 && <><strong>{t.semBaixa}</strong> {t.semBaixa === 1 ? 'item vendido não baixou' : 'itens vendidos não baixaram'} o estoque (produto sem código, ou venda ainda sem baixa): o custo dele aparece zerado e o lucro fica maior do que o real. </>}
            {t.semCusto > 0 && <><strong>{t.semCusto}</strong> {t.semCusto === 1 ? 'item saiu' : 'itens saíram'} com custo zero (produto ainda sem entrada com custo). Lance a compra ou o saldo inicial com custo para o lucro refletir a realidade.</>}
          </p>
        </div>
      )}

      {f.dim !== 'dia' && d.evolucao.length > 1 && <EvolucaoDiaria dias={d.evolucao.map((e) => ({ dia: e.rotulo, faturamento: e.faturamento, lucro: e.lucro }))} />}

      {d.linhas.length === 0 ? (
        <EmptyState icon={TrendingUp} title="Nenhuma venda neste período" hint="Quando o Norte Vendas fechar mesas e balcões, o faturamento e o lucro aparecem aqui." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
          <table className="w-full text-[14px] sm:min-w-[720px]">
            <thead className="border-b border-[var(--border)]">
              <tr>
                <Th o="rotulo" esq>{DIMS_LUCRO.find((x) => x.value === f.dim)?.label}</Th>
                <Th o="quantidade" extra="hidden sm:table-cell">Qtde</Th><Th o="faturamento">Faturamento</Th><Th o="cmv" extra="hidden sm:table-cell">Custo</Th><Th o="lucro">Lucro</Th><Th o="margem" extra="hidden sm:table-cell">Margem</Th>
              </tr>
            </thead>
            <tbody>
              {d.linhas.slice(0, 500).map((l: LinhaLucro) => (
                <tr key={l.rotulo} className="border-b border-[var(--border)] last:border-0 hover:bg-surface-2/60">
                  <td className="px-2 py-2 sm:px-3 text-text">
                    {l.rotulo}
                    {l.itens_sem_baixa > 0 && <span title="Sem baixa de estoque" className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">sem baixa</span>}
                    {l.itens_sem_baixa === 0 && l.itens_sem_custo > 0 && <span title="Saiu com custo zero" className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">sem custo</span>}
                  </td>
                  <td className="num hidden px-2 py-2 sm:px-3 text-right text-text-muted sm:table-cell">{qtd(l.quantidade)}</td>
                  <td className="num px-2 py-2 sm:px-3 text-right text-text">{moeda(l.faturamento)}</td>
                  <td className="num hidden px-2 py-2 sm:px-3 text-right text-text-muted sm:table-cell">{moeda(l.cmv)}</td>
                  <td className={`num px-2 py-2 sm:px-3 text-right font-semibold ${l.lucro < 0 ? 'text-err' : 'text-text'}`}>{moeda(l.lucro)}</td>
                  <td className={`num hidden px-2 py-2 sm:px-3 text-right sm:table-cell ${l.margem != null && l.margem < 0 ? 'text-err' : 'text-text-muted'}`}>{pct(l.margem)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--border)] bg-surface-2/60 font-semibold">
                <td className="px-2 py-2 sm:px-3 text-text"><TrendingUp className="mr-1 inline size-4 text-text-muted" />Total do período</td>
                <td className="hidden px-2 py-2 sm:px-3 sm:table-cell" />
                <td className="num px-2 py-2 sm:px-3 text-right">{moeda(t.faturamento)}</td>
                <td className="num hidden px-2 py-2 sm:px-3 text-right sm:table-cell">{moeda(t.cmv)}</td>
                <td className={`num px-2 py-2 sm:px-3 text-right ${t.lucro < 0 ? 'text-err' : ''}`}>{moeda(t.lucro)}</td>
                <td className="num hidden px-2 py-2 sm:px-3 text-right sm:table-cell">{pct(t.margem)}</td>
              </tr>
            </tfoot>
          </table>
          {d.linhas.length > 500 && <p className="px-2 py-2 sm:px-3 text-[12px] text-text-muted">Mostrando as 500 primeiras linhas de {d.linhas.length}. A planilha traz todas.</p>}
        </div>
      )}
    </div>
  )
}
