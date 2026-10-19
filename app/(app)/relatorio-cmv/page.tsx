import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Calculator, Download } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { FiltrosFaturamento } from '@/components/faturamento/FiltrosFaturamento'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { carregarCmv } from '@/lib/relatorios/cmv-loader'
import { agruparCmv, cmvFormulaOmie, resumoCmv } from '@/lib/relatorios/cmv-puro'
import { DIM_DA_ABA, lerParamsCmv, paramsBaseCmv, textoFonte, type SpCmv } from '@/lib/relatorios/cmv-params'

const LIMITE = 500
const TIPOS_OMIE = ['00', '04', '99'] // filtro padrão do relatório CMV/CPV do Omie
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtPct = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`)
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default async function CmvPage({ searchParams }: { searchParams: Promise<SpCmv> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const hoje = hojeBahiaISO()
  const p = lerParamsCmv(await searchParams, hoje)
  const d = await carregarCmv(lojaId, p.ini, p.fim, { tipos: p.tipos, familias: p.familias }, DIM_DA_ABA[p.aba])
  const kardex = d.fonte === 'kardex'
  const aba = p.aba === 'estoque' && !kardex ? 'produtos' : p.aba
  const resumo = resumoCmv(d.linhas)
  const agrupadas = d.fonte === 'proprio' ? d.linhas : agruparCmv(d.linhas, DIM_DA_ABA[aba])
  const termo = semAcento(p.q.trim())
  const linhas = agrupadas
    .filter((l) => (aba === 'estoque' ? true : l.faturamento !== 0 || l.cmv !== 0))
    .filter((l) => !termo || semAcento(l.rotulo).includes(termo))

  const base = paramsBaseCmv({ ...p, aba })
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/relatorio-cmv${q.size ? `?${q}` : ''}`
  }
  const exportQs = new URLSearchParams(Object.entries(base).filter(([, v]) => v)).toString()
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'
  const abas = [
    { value: 'produtos', label: 'Produtos' }, { value: 'familias', label: 'Famílias' }, { value: 'tipos', label: 'Tipos' },
    ...(kardex ? [{ value: 'estoque', label: 'Pelo estoque (EI + C + P − EF)' }] : []),
  ]
  const formulaTotal = (fil: (tipo: string) => boolean) => d.linhas.filter((l) => fil(l.tipoCod)).reduce((s, l) => s + cmvFormulaOmie(l), 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="CMV / CPV"
        icon={Calculator}
        voltarHref="/relatorios"
        description="Quanto custou o que foi vendido (CMV) e o que foi consumido na produção (CPV), por produto, família e tipo."
        actions={linhas.length > 0 ? <a href={`/relatorio-cmv/export?${exportQs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}><Download className="size-4" /> Baixar</a> : undefined}
      />
      <PeriodoBar basePath="/relatorio-cmv" params={base} ini={p.ini} fim={p.fim} hoje={hoje} />
      {d.fonte !== 'proprio' && <FiltrosFaturamento tipos={d.opcoes.tipos} familias={d.opcoes.familias} />}

      <p className={`rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] shadow-[var(--shadow-sm)] ${d.fonte === 'estimado' ? 'text-warn' : 'text-text-muted'}`}>{textoFonte(d.fonte, d.cobertura, d.dataFoto)}</p>
      {p.cortado && <p className="text-[13px] text-text-muted">Período limitado a 366 dias: mostrando os dias mais recentes.</p>}
      {d.avisos.map((a) => <p key={a} className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{a}</p>)}
      {resumo.custoSuspeito > 0 && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{resumo.custoSuspeito.toLocaleString('pt-BR')} produto(s) com custo médio de hoje acima do preço de venda (custo fora do normal no Omie) ficaram com custo zero: <Money value={resumo.faturamentoSuspeito} /> de faturamento sem custo. O CMV estimado fica abaixo do real.</p>}
      {resumo.semCusto > 0 && <p className="text-[13px] text-text-muted">{resumo.semCusto.toLocaleString('pt-BR')} item(ns) vendido(s) sem custo ({d.fonte === 'kardex' ? 'sem saída no kardex, ex.: taxa de serviço' : d.fonte === 'proprio' ? 'sem baixa ou com baixa sem custo' : 'sem custo médio na foto, ex.: taxa de serviço'}): entram com custo zero.</p>}

      {d.linhas.length === 0 ? (
        <EmptyState icon={Calculator} title="Sem vendas no período" hint="Mude o período ou limpe os filtros." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CartaoResumo titulo="Faturamento" valor={<Money value={resumo.faturamento} />} />
            <CartaoResumo titulo="CMV (custo das vendas)" valor={<Money value={resumo.cmv} />} sub={resumo.faturamento > 0 ? `${fmtPct(Math.round((resumo.cmv / resumo.faturamento) * 1000) / 10)} do faturamento` : undefined} />
            <CartaoResumo titulo="Margem bruta" valor={<Money value={resumo.margem} />} sub={fmtPct(resumo.margemPct)} />
            {kardex
              ? <CartaoResumo titulo="CPV (consumo da produção)" valor={<Money value={resumo.consumo} />} sub="Insumos consumidos nas OPs" />
              : <CartaoResumo titulo="Itens sem custo" valor={resumo.semCusto.toLocaleString('pt-BR')} />}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {abas.map((a) => <Link key={a.value} href={href({ aba: a.value === 'produtos' ? '' : a.value })} className={chip(aba === a.value)}>{a.label}</Link>)}
          </div>
          {d.filtrosIgnorados && <p className="text-[13px] text-text-muted">Na loja de estoque próprio os filtros de tipo e família ainda não se aplicam a este relatório.</p>}
          {aba === 'estoque' && (
            <p className="text-[13px] text-text-muted">
              Fórmula do relatório CMV/CPV do Omie, por produto. Tipos 00, 04 e 99 (filtro padrão do Omie): <Money value={formulaTotal((t) => TIPOS_OMIE.includes(t))} />;
              todos os tipos (soma também o consumo de insumos, que já está no custo dos pratos): <Money value={formulaTotal(() => true)} />.
            </p>
          )}

          <form action="/relatorio-cmv" className="flex flex-wrap items-center gap-2">
            {Object.entries(base).filter(([k, v]) => v && k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={p.q} placeholder="Buscar…" className="h-9 w-60 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text" />
            <button type="submit" className={chip(false)}>Buscar</button>
          </form>

          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
            {aba === 'estoque' ? (
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead><tr className="border-b border-border">
                  <th className={`text-left ${th}`}>Produto</th>
                  <th className={`text-right ${th}`}>Estoque inicial</th><th className={`text-right ${th}`}>Compras</th><th className={`text-right ${th}`}>Produção</th>
                  <th className={`text-right ${th}`}>Estoque final</th><th className={`text-right ${th}`}>EI + C + P − EF</th>
                  <th className={`text-right ${th}`}>Vendas</th><th className={`text-right ${th}`}>Consumo OP</th><th className={`text-right ${th}`}>Outras saídas − entradas</th>
                </tr></thead>
                <tbody>
                  {linhas.slice(0, LIMITE).map((l) => (
                    <tr key={l.chave} className="border-t border-border/60">
                      <td className="px-3 py-2"><div className="max-w-[260px] truncate text-text" title={l.rotulo}>{l.rotulo}</div><div className="text-[12px] text-text-muted">{l.tipo}</div></td>
                      {[l.ei, l.compras, l.producao, l.ef].map((v, i) => <td key={i} className="num whitespace-nowrap px-3 py-2 text-right text-text-muted"><Money value={v} /></td>)}
                      <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text"><Money value={cmvFormulaOmie(l)} /></td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text"><Money value={l.cmv} /></td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text"><Money value={l.consumo} /></td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted"><Money value={l.outrasSaidas - l.outrasEntradas} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead><tr className="border-b border-border">
                  <th className={`text-left ${th}`}>{aba === 'familias' ? 'Família' : aba === 'tipos' ? 'Tipo' : 'Produto'}</th>
                  <th className={`text-right ${th}`}>Quantidade</th><th className={`text-right ${th}`}>Faturamento</th><th className={`text-right ${th}`}>CMV</th>
                  <th className={`text-right ${th}`}>Margem</th><th className={`text-right ${th}`}>Margem %</th>
                  {kardex && <th className={`hidden text-right md:table-cell ${th}`}>Consumo OP</th>}
                </tr></thead>
                <tbody>
                  {linhas.slice(0, LIMITE).map((l) => {
                    const mg = l.faturamento - l.cmv
                    const pct = l.faturamento > 0 ? Math.round((mg / l.faturamento) * 1000) / 10 : null
                    return (
                      <tr key={l.chave} className="border-t border-border/60">
                        <td className="px-3 py-2"><div className="max-w-[280px] truncate text-text" title={l.rotulo}>{l.rotulo}</div>{aba === 'produtos' && d.fonte !== 'proprio' && <div className="text-[12px] text-text-muted">{l.familia}</div>}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtQtd(l.quant)}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right text-text"><Money value={l.faturamento} /></td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text"><Money value={l.cmv} /></td>
                        <td className={`num whitespace-nowrap px-3 py-2 text-right ${mg < 0 ? 'text-err' : 'text-text'}`}><Money value={mg} /></td>
                        <td className={`num whitespace-nowrap px-3 py-2 text-right ${pct != null && pct < 0 ? 'text-err' : 'text-text-muted'}`}>{fmtPct(pct)}</td>
                        {kardex && <td className="num hidden whitespace-nowrap px-3 py-2 text-right text-text-muted md:table-cell"><Money value={l.consumo} /></td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          {linhas.length > LIMITE && <p className="text-[13px] text-text-muted">Mostrando {LIMITE} de {linhas.length.toLocaleString('pt-BR')} linhas; os cartões somam todas e o arquivo do botão Baixar traz todas.</p>}
        </>
      )}
    </div>
  )
}
