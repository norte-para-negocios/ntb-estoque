import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, Trash2 } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { btnClass } from '@/components/ui-kit/Button'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { carregarCadastro, carregarPerdas } from '@/lib/estoque/consumo-perdas-loader'
import { ROTULO_CAUSA } from '@/lib/estoque/perdas-puro'
import { lerFiltroPerdas, type SpPerdas } from './filtro'

// T5.4 (Fase 5), só desenvolvedor: perdas e desperdício com causa (ajuste manual com motivo, lote vencido, quebra, inventário).
type Sp = SpPerdas

const LIMITE = 500
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtData = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }

export default async function PerdasPage({ searchParams }: { searchParams: Promise<Sp> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const { p, causa } = lerFiltroPerdas(sp, hoje)
  const avisos: string[] = []
  const [cad, r] = await Promise.all([carregarCadastro(lojaId, avisos), carregarPerdas(lojaId, p.ini, p.fim, avisos)])
  const nomeLocal = new Map(cad.locais.map((l) => [l.codigo, l.descricao]))
  const linhas = causa ? r.linhas.filter((l) => l.causa === causa) : r.linhas
  const maior = r.porCausa.find((c) => c.causa !== 'correcao')

  const base: Record<string, string> = { ini: p.ini, fim: p.fim, causa: causa ?? '' }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/relatorio-perdas${q.size ? `?${q}` : ''}`
  }
  const exportHref = href({}).replace('/relatorio-perdas', '/relatorio-perdas/export')
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'

  return (
    <div className="space-y-4">
      <PageHeader title="Perdas e desperdício" icon={Trash2} voltarHref="/relatorios"
        description="Tudo que saiu do estoque sem ser vendido nem produzido, com a causa: vencimento, quebra, desperdício e diferença de inventário."
        actions={<a href={exportHref} className={btnClass('outline')}><Download className="size-4" /> Exportar Excel</a>} />
      <PeriodoBar basePath="/relatorio-perdas" params={base} ini={p.ini} fim={p.fim} hoje={hoje} />
      {p.cortado && <p className="text-[13px] text-text-muted">Período limitado a 366 dias.</p>}
      {avisos.map((a) => <p key={a} className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{a}</p>)}

      {r.linhas.length === 0 ? (
        <EmptyState icon={Trash2} title="Nenhuma perda lançada no período" hint="Perdas entram pelo ajuste de estoque (com motivo), pela baixa de lote vencido e pelo inventário." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CartaoResumo titulo="Perdas no período" valor={<Money value={r.totalPerdas} />} sub={`${r.linhas.filter((l) => l.causa !== 'correcao').length.toLocaleString('pt-BR')} lançamento(s)`} />
            <CartaoResumo titulo="Maior causa" valor={maior ? ROTULO_CAUSA[maior.causa] : '—'} sub={maior ? maior.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : undefined} />
            <CartaoResumo titulo="Vencimento" valor={<Money value={r.porCausa.find((c) => c.causa === 'vencimento')?.valor ?? 0} />} />
            <CartaoResumo titulo="Correções de dados" valor={<Money value={r.totalCorrecoes} />} sub="Não somam nas perdas" />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={href({ causa: '' })} className={chip(causa == null)}>Todas</Link>
            {r.porCausa.map((c) => <Link key={c.causa} href={href({ causa: c.causa })} className={chip(causa === c.causa)}>{ROTULO_CAUSA[c.causa]} · {c.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</Link>)}
          </div>

          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead><tr className="border-b border-border">
                <th className={`text-left ${th}`}>Data</th><th className={`text-left ${th}`}>Produto</th><th className={`text-left ${th}`}>Causa</th>
                <th className={`text-right ${th}`}>Quantidade</th><th className={`text-right ${th}`}>Valor</th><th className={`text-left ${th}`}>Motivo</th>
              </tr></thead>
              <tbody>
                {linhas.slice(0, LIMITE).map((l) => {
                  const pr = cad.produtos.get(l.produto)
                  return (
                    <tr key={l.id} className="border-t border-border/60">
                      <td className="num whitespace-nowrap px-3 py-2 text-text-muted">{fmtData(l.data)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/estoque/produto/${l.produto}`} className="block max-w-[240px] truncate text-text hover:underline" title={pr?.descricao}>{pr?.descricao ?? l.produto}</Link>
                        <div className="text-[12px] text-text-muted">{nomeLocal.get(l.local) ?? l.local}</div>
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 ${l.causa === 'correcao' ? 'text-text-muted' : 'text-text'}`}>{ROTULO_CAUSA[l.causa]}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtQtd(l.quantidade)} {pr?.unidade ?? ''}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text"><Money value={l.valor} /></td>
                      <td className="px-3 py-2 text-[13px] text-text-muted"><div className="max-w-[360px] truncate" title={l.motivo ?? ''}>{l.motivo ?? '—'}</div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {linhas.length > LIMITE && <p className="text-[13px] text-text-muted">Mostrando {LIMITE} de {linhas.length.toLocaleString('pt-BR')} lançamentos; os cartões somam todos.</p>}
        </>
      )}
    </div>
  )
}
