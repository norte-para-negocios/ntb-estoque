import Link from 'next/link'
import { BotaoImprimir } from '@/components/relatorios/BotaoImprimir'
import { notFound } from 'next/navigation'
import { Download, TrendingUp } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { btnClass } from '@/components/ui-kit/Button'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { LimiteVariacaoPreco } from '@/components/relatorios/LimiteVariacaoPreco'
import { carregarVariacaoPreco, limiteVariacaoPreco } from '@/lib/estoque/consumo-perdas-loader'
import { alertasDaLista } from '@/lib/compras/variacao-preco-puro'
import { lerFiltroVariacao, type SpVariacao } from './filtro'

// T5.4 (Fase 5), só desenvolvedor: itens de nota cujo preço mudou mais que o limite da loja contra a última compra.
type Sp = SpVariacao

const fmtData = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

export default async function VariacaoPrecoPage({ searchParams }: { searchParams: Promise<Sp> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const { p, ver } = lerFiltroVariacao(sp, hoje)
  const [cfg, d] = await Promise.all([limiteVariacaoPreco(lojaId), carregarVariacaoPreco(lojaId, { ini: p.ini, fim: p.fim })])
  const todos = alertasDaLista(d.linhas, cfg.limite)
  const alertas = ver ? todos.filter((a) => a.alerta.sentido === ver) : todos
  const subiram = todos.filter((a) => a.alerta.sentido === 'subiu').length
  const comparados = d.linhas.filter((l) => l.variacao_pct != null).length

  const base: Record<string, string> = { ini: p.ini, fim: p.fim, ver: ver ?? '' }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/relatorio-variacao-preco${q.size ? `?${q}` : ''}`
  }
  const exportHref = href({}).replace('/relatorio-variacao-preco', '/relatorio-variacao-preco/export')
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'

  return (
    <div className="space-y-4">
      <PageHeader title="Variação de preço nas notas" icon={TrendingUp} voltarHref="/relatorios"
        description="Itens de nota cujo preço por unidade mudou além do limite da loja em relação à compra anterior do mesmo produto."
        actions={<>{<a href={exportHref} className={btnClass('outline')}><Download className="size-4" /> Exportar Excel</a>}<BotaoImprimir /></>} />
      <PeriodoBar basePath="/relatorio-variacao-preco" params={base} ini={p.ini} fim={p.fim} hoje={hoje} />
      <p className="hidden text-[13px] text-text-muted print:block">Período: {p.ini.split('-').reverse().join('/')} a {p.fim.split('-').reverse().join('/')}</p>
      <div className="print:hidden"><LimiteVariacaoPreco atual={cfg.limite} /></div>
      {cfg.aviso && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{cfg.aviso}</p>}
      <p className="text-[13px] text-text-muted">Preço por unidade de estoque = valor dos produtos menos o desconto, dividido pela quantidade recebida. Sem compra anterior, compara com o custo médio.</p>

      {d.erro ? (
        <p role="alert" className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-err shadow-[var(--shadow-sm)]">{d.erro}</p>
      ) : todos.length === 0 ? (
        <EmptyState icon={TrendingUp} title={`Nenhum preço mudou mais de ${cfg.limite.toLocaleString('pt-BR')}% no período`} hint={`${comparados.toLocaleString('pt-BR')} item(ns) de nota comparado(s).`} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <CartaoResumo titulo="Itens com alerta" valor={todos.length.toLocaleString('pt-BR')} sub={`de ${comparados.toLocaleString('pt-BR')} comparados`} />
            <CartaoResumo titulo="Subiram" valor={subiram.toLocaleString('pt-BR')} />
            <CartaoResumo titulo="Caíram" valor={(todos.length - subiram).toLocaleString('pt-BR')} sub="Confira a unidade da nota" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 print:hidden">
            <Link href={href({ ver: '' })} className={chip(ver == null)}>Todos</Link>
            <Link href={href({ ver: 'subiu' })} className={chip(ver === 'subiu')}>Subiram</Link>
            <Link href={href({ ver: 'caiu' })} className={chip(ver === 'caiu')}>Caíram</Link>
          </div>
          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead><tr className="border-b border-border">
                <th className={`text-left ${th}`}>Nota</th><th className={`text-left ${th}`}>Produto</th>
                <th className={`text-right ${th}`}>Preço agora</th><th className={`text-right ${th}`}>Antes</th><th className={`text-right ${th}`}>Variação</th>
              </tr></thead>
              <tbody>
                {alertas.map((a) => (
                  <tr key={a.itemId} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      {a.notaId ? <Link href={`/nota-fiscal/${a.notaId}`} className="text-text hover:underline">Nota {a.numero ?? a.compraId}</Link> : <span className="text-text">Compra {a.numero ?? a.compraId}</span>}
                      <div className="text-[12px] text-text-muted">{fmtData(a.data)} · {a.fornecedor ?? 'sem fornecedor'}{a.status !== 'lancada' ? ` · ${a.status}` : ''}</div>
                    </td>
                    <td className="px-3 py-2"><Link href={`/estoque/produto/${a.produto}`} className="block max-w-[260px] truncate text-text hover:underline" title={a.descricao ?? ''}>{a.descricao ?? a.produto}</Link></td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-text"><Money value={a.precoBase} /></td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted"><Money value={a.precoAnterior} /><div className="text-[11px]">{a.fonte === 'cmc' ? 'custo médio' : 'última compra'}</div></td>
                    <td className={`num whitespace-nowrap px-3 py-2 text-right font-medium ${a.alerta.sentido === 'subiu' ? 'text-err' : 'text-warn'}`}>{fmtPct(a.alerta.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
