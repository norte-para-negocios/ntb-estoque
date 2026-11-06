import Link from 'next/link'
import { BotaoImprimir } from '@/components/relatorios/BotaoImprimir'
import { notFound } from 'next/navigation'
import { Download, Scale } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { btnClass } from '@/components/ui-kit/Button'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { carregarCadastro, carregarConsumo } from '@/lib/estoque/consumo-perdas-loader'
import { estadoTelaConsumo, maioresDesvios, resumoConsumo, textoSemContagem, type LinhaConsumo } from '@/lib/estoque/consumo-real-puro'
import { lerFiltroConsumo, linhasDaVisao, type SpConsumo } from './filtro'

// T5.3 (Fase 5), só desenvolvedor: consumo teórico (ficha × vendas + OP) × real (inventários), por insumo e local.
type Sp = SpConsumo

const LIMITE = 500
const fmtQtd = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }))
const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' }) : '—')

export default async function ConsumoPage({ searchParams }: { searchParams: Promise<Sp> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const { p, local, ver } = lerFiltroConsumo(sp, hoje)
  const avisos: string[] = []
  const [cad, d] = await Promise.all([carregarCadastro(lojaId, avisos), carregarConsumo(lojaId, p.ini, p.fim, local)])
  const estado = estadoTelaConsumo(d.linhas, d.erro)
  const resumo = resumoConsumo(d.linhas)
  const top = maioresDesvios(d.linhas, 10)
  const nomeLocal = new Map(cad.locais.map((l) => [l.codigo, l.descricao]))
  const prod = (l: LinhaConsumo) => cad.produtos.get(l.produto)
  const lista = linhasDaVisao(d.linhas, ver)

  const base: Record<string, string> = { ini: p.ini, fim: p.fim, local: local ? String(local) : '', ver: ver === 'sem' ? 'sem' : '' }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/relatorio-consumo${q.size ? `?${q}` : ''}`
  }
  const exportHref = href({}).replace('/relatorio-consumo', '/relatorio-consumo/export')
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`
  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'
  const td = 'num whitespace-nowrap px-3 py-2 text-right'
  const corDesvio = (v: number | null) => (v == null || Math.abs(v) < 0.005 ? 'text-text-muted' : v > 0 ? 'text-err' : 'text-text')

  const nomeProduto = (l: LinhaConsumo) => (
    <td className="px-3 py-2">
      <Link href={`/estoque/produto/${l.produto}`} className="block max-w-[260px] truncate text-text hover:underline" title={prod(l)?.descricao}>{prod(l)?.descricao ?? l.produto}</Link>
      <div className="text-[12px] text-text-muted">{nomeLocal.get(l.local) ?? l.local}{prod(l)?.unidade ? ` · ${prod(l)!.unidade}` : ''}{l.custoEstimado && <span className="ml-1 text-warn">· custo estimado</span>}</div>
    </td>
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Consumo teórico × real" icon={Scale} voltarHref="/relatorios"
        description="Quanto a ficha técnica mandou baixar (vendas e produção) contra o que saiu de verdade entre duas contagens de estoque. A diferença em reais é o desvio."
        actions={<>{<a href={exportHref} className={btnClass('outline')}><Download className="size-4" /> Exportar Excel</a>}<BotaoImprimir /></>} />
      <PeriodoBar basePath="/relatorio-consumo" params={base} ini={p.ini} fim={p.fim} hoje={hoje} />
      <p className="hidden text-[13px] text-text-muted print:block">Período: {p.ini.split('-').reverse().join('/')} a {p.fim.split('-').reverse().join('/')}</p>
      <div className="flex flex-wrap items-center gap-1.5 print:hidden">
        <Link href={href({ local: '' })} className={chip(local == null)}>Todos os locais</Link>
        {cad.locais.map((l) => <Link key={l.codigo} href={href({ local: String(l.codigo) })} className={chip(local === l.codigo)}>{l.descricao}</Link>)}
      </div>
      {p.cortado && <p className="text-[13px] text-text-muted">Período limitado a 366 dias.</p>}
      {avisos.map((a) => <p key={a} className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{a}</p>)}
      <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
        Teórico = vendas baixadas pela ficha + insumos das ordens de produção. Real = 1ª contagem do período + entradas (compras, produção, transferências) − última contagem.
        Desvio = real − teórico: positivo é falta (saiu mais do que a ficha manda), negativo é sobra. Em reais pelo custo médio do fim do período.
      </p>

      {estado === 'erro' ? (
        <p role="alert" className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-err shadow-[var(--shadow-sm)]">{d.erro}</p>
      ) : estado === 'vazio' ? (
        <EmptyState icon={Scale} title="Sem vendas, produção nem contagem no período" hint="Mude o período ou o local." />
      ) : (
        <>
          {estado === 'sem_contagem' && (
            <div className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">
              <p className="font-semibold">Sem contagem no começo e no fim do período: o consumo real não foi calculado.</p>
              <p className="text-text-muted">Para ter o real, faça um inventário no começo e outro no fim do período (no mesmo local). Abaixo, só o teórico.
                {' '}<Link href="/inventario" className="text-accent hover:underline">Abrir Inventários</Link></p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CartaoResumo titulo="Teórico (com contagem)" valor={<Money value={resumo.teoricoValor} />} sub={`${resumo.comContagem.toLocaleString('pt-BR')} insumo(s) com contagem`} />
            <CartaoResumo titulo="Real" valor={resumo.comContagem ? <Money value={resumo.realValor} /> : 'sem contagem'} />
            <CartaoResumo titulo="Desvio" valor={resumo.comContagem ? <Money value={resumo.desvioValor} /> : 'sem contagem'}
              sub={resumo.comContagem ? `falta ${resumo.faltaValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · sobra ${resumo.sobraValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : undefined} />
            <CartaoResumo titulo="Sem contagem" valor={resumo.semContagem.toLocaleString('pt-BR')} sub={`teórico ${resumo.teoricoSemContagemValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`} />
          </div>

          {top.length > 0 && (
            <section className="rounded-[var(--r-lg)] bg-surface p-3 shadow-[var(--shadow-sm)]">
              <h2 className="mb-2 text-[15px] font-semibold text-text">Maiores desvios em reais</h2>
              <ol className="space-y-1 text-sm">
                {top.map((l, i) => (
                  <li key={`${l.local}-${l.produto}`} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-text">{i + 1}. {prod(l)?.descricao ?? l.produto} <span className="text-[12px] text-text-muted">· {nomeLocal.get(l.local) ?? l.local} · {fmtQtd(l.desvio)} {prod(l)?.unidade ?? ''}</span></span>
                    <Money value={l.desvioValor} className={corDesvio(l.desvioValor)} />
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-1.5 print:hidden">
            <Link href={href({ ver: '' })} className={chip(ver === 'com')}>Com contagem ({resumo.comContagem})</Link>
            <Link href={href({ ver: 'sem' })} className={chip(ver === 'sem')}>Sem contagem ({resumo.semContagem})</Link>
          </div>

          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
            {ver === 'com' ? (
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead><tr className="border-b border-border">
                  <th className={`text-left ${th}`}>Insumo</th>
                  <th className={`text-right ${th}`}>Contagem inicial</th><th className={`text-right ${th}`}>Entradas</th><th className={`text-right ${th}`}>Contagem final</th>
                  <th className={`text-right ${th}`}>Real</th><th className={`text-right ${th}`}>Teórico</th><th className={`text-right ${th}`}>Desvio</th>
                  <th className={`text-right ${th}`}>Desvio R$</th><th className={`text-right ${th}`}>Perda lançada</th>
                </tr></thead>
                <tbody>
                  {lista.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-[13px] text-text-muted">Nenhum insumo com contagem no começo e no fim do período.</td></tr>}
                  {lista.slice(0, LIMITE).map((l) => (
                    <tr key={`${l.local}-${l.produto}`} className="border-t border-border/60">
                      {nomeProduto(l)}
                      <td className={`${td} text-text-muted`} title={`Inventário #${l.inventarioIni}`}>{fmtQtd(l.saldoIni)}<div className="text-[11px]">{fmtData(l.contadoIniEm)}</div></td>
                      <td className={`${td} text-text-muted`}>{fmtQtd(l.entradas)}</td>
                      <td className={`${td} text-text-muted`} title={`Inventário #${l.inventarioFim}`}>{fmtQtd(l.saldoFim)}<div className="text-[11px]">{fmtData(l.contadoFimEm)}</div></td>
                      <td className={`${td} text-text`}>{fmtQtd(l.consumoReal)}</td>
                      <td className={`${td} text-text`} title={`Vendas ${fmtQtd(l.teoricoVenda)} · OPs ${fmtQtd(l.teoricoOp)}`}>{fmtQtd(l.teorico)}</td>
                      <td className={`${td} ${corDesvio(l.desvio)}`}>{fmtQtd(l.desvio)}</td>
                      <td className={`${td} font-medium ${corDesvio(l.desvioValor)}`}><Money value={l.desvioValor} /></td>
                      <td className={`${td} text-text-muted`}>{l.ajustesPerdas ? fmtQtd(l.ajustesPerdas) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead><tr className="border-b border-border">
                  <th className={`text-left ${th}`}>Insumo</th><th className={`text-right ${th}`}>Vendas</th><th className={`text-right ${th}`}>Ordens de produção</th>
                  <th className={`text-right ${th}`}>Teórico R$</th><th className={`text-left ${th}`}>Real</th>
                </tr></thead>
                <tbody>
                  {lista.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-[13px] text-text-muted">Todos os insumos consumidos têm contagem no começo e no fim.</td></tr>}
                  {lista.slice(0, LIMITE).map((l) => (
                    <tr key={`${l.local}-${l.produto}`} className="border-t border-border/60">
                      {nomeProduto(l)}
                      <td className={`${td} text-text`}>{fmtQtd(l.teoricoVenda)}</td>
                      <td className={`${td} text-text`}>{fmtQtd(l.teoricoOp)}</td>
                      <td className={`${td} text-text`}><Money value={l.teoricoValor} /></td>
                      <td className="px-3 py-2 text-[13px] text-text-muted">{textoSemContagem(l.contagens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {lista.length > LIMITE && <p className="text-[13px] text-text-muted">Mostrando {LIMITE} de {lista.length.toLocaleString('pt-BR')} linhas; os cartões somam todas.</p>}
          <p className="text-[12px] text-text-muted">Calculado em {(d.ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} s.</p>
        </>
      )}
    </div>
  )
}
