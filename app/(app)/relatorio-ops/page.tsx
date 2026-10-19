import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, Factory } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { FiltrosFaturamento } from '@/components/faturamento/FiltrosFaturamento'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'
import { agregarOps, filtrarOps, resumoOps, serieOps } from '@/lib/relatorios/ops-periodo-puro'
import { carregarOps, lerParamsOps, paramsBaseOps, type FonteOps, type SpOps } from '@/lib/relatorios/ops-periodo-loader'

const LIMITE = 500
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const dataBR = (iso: string) => iso.split('-').reverse().join('/')
const FONTE: Record<FonteOps, string> = {
  proprio: 'OPs concluídas no app, com o que cada produção realmente baixou do estoque e o custo de cada insumo.',
  kardex: 'Kardex do Omie: tudo o que o Omie lançou como entrada (produção) e consumo de OP no período, com o valor de cada movimento.',
  ops: 'OPs concluídas sincronizadas do Omie; o consumo vem da ficha gravada em cada OP (sem custo). OPs que o Omie criou e não vieram na sincronização ficam de fora.',
}

export default async function RelatorioOpsPage({ searchParams }: { searchParams: Promise<SpOps> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) === 'nenhum') notFound()
  const hoje = hojeBahiaISO()
  const p = lerParamsOps(await searchParams, hoje)
  const { fonte, cobertura, brutas, meta, erros, opcoes } = await carregarOps(lojaId, p.ini, p.fim)
  const filtros = { tipos: p.tipos, familias: p.familias, q: p.q }
  const vis = filtrarOps(brutas, meta, filtros)
  const res = resumoOps(vis)
  const linhas = p.visao === 'dias' ? [] : agregarOps(brutas, meta, p.visao === 'consumidos' ? 'consumido' : 'produzido', filtros)
  const serie = p.visao === 'dias' ? serieOps(vis, p.ini, p.fim) : []
  const nomeOps = fonte === 'kardex' ? 'Movimentos' : 'OPs'

  const base = paramsBaseOps(p)
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/relatorio-ops${q.size ? `?${q}` : ''}`
  }
  const exportQs = new URLSearchParams(Object.entries(base).filter(([, v]) => v)).toString()
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'
  const temCusto = linhas.some((l) => l.custo != null)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produção por produto"
        icon={Factory}
        voltarHref="/relatorios"
        description="O que foi produzido e quanta matéria-prima a produção consumiu no período, produto a produto."
        actions={brutas.length > 0 ? <a href={`/relatorio-ops/export?${exportQs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}><Download className="size-4" /> Baixar</a> : undefined}
      />

      <PeriodoBar basePath="/relatorio-ops" params={base} ini={p.ini} fim={p.fim} hoje={hoje} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={href({ ver: '' })} className={chip(p.visao === 'produzidos')}>Produzidos</Link>
        <Link href={href({ ver: 'consumidos' })} className={chip(p.visao === 'consumidos')}>Matéria-prima consumida</Link>
        <Link href={href({ ver: 'dias' })} className={chip(p.visao === 'dias')}>Por dia</Link>
      </div>
      <FiltrosFaturamento tipos={opcoes.tipos} familias={opcoes.familias} semSituacao />

      <p className="flex items-start gap-2 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
        <span className="mt-[5px] size-2 shrink-0 rounded-full bg-brand" aria-hidden />
        <span>{FONTE[fonte]}{fonte === 'kardex' && cobertura ? ` Histórico completo de ${dataBR(cobertura.desde)} a ${dataBR(cobertura.ate)}.` : ''}</span>
      </p>
      {p.cortado && <p className="text-[13px] text-text-muted">Período limitado a 366 dias: mostrando os dias mais recentes.</p>}
      {erros.length > 0 && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">Falha ao ler: {erros.join(', ')}. Os números podem estar incompletos; recarregue a página.</p>}

      {brutas.length === 0 ? (
        <EmptyState icon={Factory} title="Nenhuma produção concluída no período" hint="Mude o período. Só entram ordens de produção concluídas." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CartaoResumo titulo={fonte === 'kardex' ? 'Entradas de produção' : 'OPs concluídas'} valor={res.ops.toLocaleString('pt-BR')} sub={`${res.produtos.toLocaleString('pt-BR')} produtos`} />
            <CartaoResumo titulo="Insumos consumidos" valor={res.insumos.toLocaleString('pt-BR')} sub="produtos diferentes" />
            <CartaoResumo titulo="Custo da produção" valor={res.custoProduzido == null ? '—' : <Money value={res.custoProduzido} />} sub={res.custoProduzido == null ? 'sem custo nesta fonte' : 'valor do que entrou'} />
            <CartaoResumo titulo="Custo do consumo" valor={res.custoConsumido == null ? '—' : <Money value={res.custoConsumido} />} sub={res.custoConsumido == null ? 'sem custo nesta fonte' : 'valor do que saiu'} />
          </div>

          {p.visao !== 'dias' && (
            <form action="/relatorio-ops" className="flex flex-wrap items-center gap-2">
              {Object.entries(base).filter(([k, v]) => v && k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <input name="q" defaultValue={p.q} placeholder="Buscar produto…" className="h-9 w-60 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text" />
              <button type="submit" className={chip(false)}>Buscar</button>
            </form>
          )}

          {p.visao === 'dias' ? (
            <div className="space-y-3">
              <BarrasDiarias dias={serie.map((d) => ({ dia: d.dia, valor: d.ops }))} nome={nomeOps} hoje={hoje} emReais={false} />
              <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
                <table className="w-full min-w-[360px] border-collapse text-sm">
                  <thead><tr className="border-b border-border"><th className={`text-left ${th}`}>Dia</th><th className={`text-right ${th}`}>{nomeOps}</th><th className={`text-right ${th}`}>Quantidade produzida</th></tr></thead>
                  <tbody>
                    {[...serie].reverse().filter((d) => d.ops > 0).map((d) => (
                      <tr key={d.dia} className="border-t border-border/60">
                        <td className="num px-3 py-2 text-text">{dataBR(d.dia)}</td>
                        <td className="num px-3 py-2 text-right text-text">{d.ops.toLocaleString('pt-BR')}</td>
                        <td className="num px-3 py-2 text-right text-text-muted">{fmtQtd(d.qtde)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-1 text-[12px] text-text-muted">A quantidade soma unidades diferentes (un, kg, l): serve para ver o ritmo, não como total.</p>
            </div>
          ) : linhas.length === 0 ? (
            <EmptyState icon={Factory} title="Nada encontrado" hint="Nenhum produto bate com a busca ou os filtros." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className={`text-left ${th}`}>{p.visao === 'consumidos' ? 'Insumo' : 'Produto'}</th>
                    <th className={`hidden text-left md:table-cell ${th}`}>Família</th>
                    <th className={`text-right ${th}`}>{p.visao === 'consumidos' ? 'Consumido' : 'Produzido'}</th>
                    <th className={`text-right ${th}`}>{nomeOps}</th>
                    <th className={`hidden text-right sm:table-cell ${th}`}>Dias</th>
                    {temCusto && <th className={`text-right ${th}`}>Custo</th>}
                  </tr>
                </thead>
                <tbody>
                  {linhas.slice(0, LIMITE).map((l) => (
                    <tr key={l.chave} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <Link href={`/estoque/produto/${l.chave}`} className="block max-w-[300px] truncate text-text hover:underline" title={l.rotulo}>{l.rotulo}</Link>
                        <div className="num text-[12px] text-text-muted">{l.codigo}</div>
                      </td>
                      <td className="hidden px-3 py-2 text-text-muted md:table-cell">{l.familia}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{fmtQtd(l.qtde)} <span className="font-normal text-text-muted">{l.unidade}</span></td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{l.ops.toLocaleString('pt-BR')}</td>
                      <td className="num hidden whitespace-nowrap px-3 py-2 text-right text-text-muted sm:table-cell">{l.dias}</td>
                      {temCusto && <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{l.custo == null ? '—' : <Money value={l.custo} />}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {linhas.length > LIMITE && <p className="text-[13px] text-text-muted">Mostrando {LIMITE} de {linhas.length.toLocaleString('pt-BR')}. O arquivo do botão Baixar traz todos.</p>}
        </>
      )}
    </div>
  )
}
