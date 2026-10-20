import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChartColumnDecreasing, Download } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { FiltrosFaturamento } from '@/components/faturamento/FiltrosFaturamento'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { carregarBaseAbc } from '@/lib/relatorios/curva-abc-loader'
import { curvaAbc, resumoAbc, ROTULO_CLASSE, type Classe } from '@/lib/relatorios/curva-abc-puro'
import { lerParamsAbc, paramsBaseAbc, type SpAbc } from '@/lib/relatorios/curva-abc-params'

const LIMITE = 1000
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const COR: Record<Classe, string> = { A: 'bg-brand-fill text-white', B: 'bg-brand-soft text-brand', C: 'bg-surface-2 text-text-muted' }

export default async function CurvaAbcPage({ searchParams }: { searchParams: Promise<SpAbc> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const hoje = hojeBahiaISO()
  const p = lerParamsAbc(await searchParams, hoje)
  const { itens, aviso, opcoes } = await carregarBaseAbc(lojaId, p.ini, p.fim, p.base, { tipos: p.tipos, familias: p.familias })
  const curva = curvaAbc(itens, p.medida)
  const resumo = resumoAbc(curva, p.medida)
  const total = curva.reduce((s, l) => s + l[p.medida], 0)
  const termo = semAcento(p.q.trim())
  const visiveis = curva.filter((l) => (!p.classe || l.classe === p.classe) && (!termo || semAcento(`${l.rotulo} ${l.codigo}`).includes(termo)))

  const base = paramsBaseAbc(p)
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/relatorio-curva-abc${q.size ? `?${q}` : ''}`
  }
  const exportQs = new URLSearchParams(Object.entries(base).filter(([, v]) => v)).toString()
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const nomeBase = p.base === 'vendas' ? 'vendas (valor faturado)' : 'compras (valor que entrou no estoque)'
  const fmtMedida = (n: number) => (p.medida === 'valor' ? <Money value={n} /> : fmtQtd(n))
  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'

  return (
    <div className="space-y-4">
      <PageHeader
        title="Curva ABC"
        icon={ChartColumnDecreasing}
        voltarHref="/relatorios"
        description="Quais produtos fazem a maior parte das vendas ou das compras. A = até 20% do acumulado, B = até 80%, C = o resto (mesma regra do Omie). Vendas pelo valor bruto (quantidade × preço, antes do desconto), como o Omie."
        actions={curva.length > 0 ? <a href={`/relatorio-curva-abc/export?${exportQs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}><Download className="size-4" /> Baixar</a> : undefined}
      />

      <PeriodoBar basePath="/relatorio-curva-abc" params={base} ini={p.ini} fim={p.fim} hoje={hoje} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-text-muted">Base</span>
        <Link href={href({ base: '' })} className={chip(p.base === 'vendas')}>Vendas</Link>
        <Link href={href({ base: 'compras' })} className={chip(p.base === 'compras')}>Compras</Link>
        <span className="ml-2 text-[12px] text-text-muted">Por</span>
        <Link href={href({ medida: '' })} className={chip(p.medida === 'valor')}>Valor</Link>
        <Link href={href({ medida: 'quant' })} className={chip(p.medida === 'quant')}>Quantidade</Link>
      </div>
      <FiltrosFaturamento tipos={opcoes.tipos} familias={opcoes.familias} />

      {p.cortado && <p className="text-[13px] text-text-muted">Período limitado a 366 dias: mostrando os dias mais recentes.</p>}
      {aviso && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{aviso}</p>}

      {curva.length === 0 ? (
        <EmptyState icon={ChartColumnDecreasing} title={p.base === 'vendas' ? 'Sem vendas no período' : 'Sem compras no período'} hint="Mude o período, a base ou limpe os filtros de tipo e família." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CartaoResumo titulo={p.medida === 'valor' ? 'Total' : 'Quantidade total'} valor={fmtMedida(total)} sub={`${curva.length.toLocaleString('pt-BR')} produtos · ${nomeBase}`} />
            {(['A', 'B', 'C'] as Classe[]).map((c) => (
              <CartaoResumo key={c} titulo={`Classe ${c}`} valor={`${resumo[c].itens.toLocaleString('pt-BR')} produtos`} sub={`${fmtPct(resumo[c].pct)} do total`} />
            ))}
          </div>

          <form action="/relatorio-curva-abc" className="flex flex-wrap items-center gap-2">
            {Object.entries(base).filter(([k, v]) => v && k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={p.q} placeholder="Buscar produto…" className="h-9 w-60 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text" />
            <button type="submit" className={chip(false)}>Buscar</button>
            <span className="text-[12px] text-text-muted">Classe</span>
            <Link href={href({ classe: '' })} className={chip(!p.classe)}>Todas</Link>
            {(['A', 'B', 'C'] as Classe[]).map((c) => <Link key={c} href={href({ classe: c })} className={chip(p.classe === c)}>{c}</Link>)}
          </form>

          {visiveis.length === 0 ? (
            <EmptyState icon={ChartColumnDecreasing} title="Nada encontrado" hint="Nenhum produto bate com a busca ou a classe." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className={`text-left ${th}`}>Classe</th>
                    <th className={`text-right ${th}`}>#</th>
                    <th className={`text-left ${th}`}>Produto</th>
                    <th className={`hidden text-left md:table-cell ${th}`}>Família</th>
                    <th className={`text-right ${th}`}>{p.medida === 'valor' ? 'Valor' : 'Quantidade'}</th>
                    <th className={`text-right ${th}`}>% do total</th>
                    <th className={`text-right ${th}`}>% acumulado</th>
                    <th className={`hidden text-right sm:table-cell ${th}`}>{p.medida === 'valor' ? 'Quantidade' : 'Valor'}</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.slice(0, LIMITE).map((l) => (
                    <tr key={l.chave} className="border-t border-border/60">
                      <td className="px-3 py-2"><span className={`inline-flex size-6 items-center justify-center rounded-full text-[12px] font-bold ${COR[l.classe]}`} title={ROTULO_CLASSE[l.classe]}>{l.classe}</span></td>
                      <td className="num px-3 py-2 text-right text-text-muted">{l.ordem}</td>
                      <td className="px-3 py-2"><div className="max-w-[280px] truncate text-text" title={l.rotulo}>{l.rotulo}</div>{l.codigo && <div className="num text-[12px] text-text-muted">{l.codigo}</div>}</td>
                      <td className="hidden px-3 py-2 text-text-muted md:table-cell">{l.familia}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{fmtMedida(l[p.medida])}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtPct(l.pct)}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtPct(l.pctAcumulado)}</td>
                      <td className="num hidden whitespace-nowrap px-3 py-2 text-right text-text-muted sm:table-cell">{p.medida === 'valor' ? fmtQtd(l.quant) : <Money value={l.valor} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {visiveis.length > LIMITE && <p className="text-[13px] text-text-muted">Mostrando os {LIMITE} primeiros de {visiveis.length.toLocaleString('pt-BR')}. O arquivo do botão Baixar traz todos.</p>}
        </>
      )}
    </div>
  )
}
