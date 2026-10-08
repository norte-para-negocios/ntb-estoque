import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DollarSign, Download } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { lerParamsFaturamento, type SpFat } from '@/lib/faturamento-params'
import { carregarItens } from '@/lib/faturamento-itens-loader'
import { filtrarPorNome, ordenarRanking, posicaoNoRanking, rankear, resumir, serieDiaria, type Dimensao } from '@/lib/faturamento-itens'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { FiltrosFaturamento } from '@/components/faturamento/FiltrosFaturamento'
import { RankingBarras } from '@/components/faturamento/RankingBarras'
import { DetalheProduto } from '@/components/faturamento/DetalheProduto'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'
import { TabelaDiaria } from '@/components/faturamento/TabelaDiaria'

const ABAS = [
  { value: 'produtos', label: 'Produtos' },
  { value: 'familias', label: 'Famílias' },
  { value: 'tipos', label: 'Tipos' },
  { value: 'dias', label: 'Por dia' },
] as const
const POR_ABA: Record<string, Dimensao> = { produtos: 'produto', familias: 'familia', tipos: 'tipo' }
const fmtDM = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export default async function FaturamentoPage({ searchParams }: { searchParams: Promise<SpFat> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const p = lerParamsFaturamento(sp, hoje)

  const { linhas, aviso, opcoes } = await carregarItens(lojaId, p.ini, p.fim, { tipos: p.tipos, familias: p.familias, situacao: p.situacao })
  const kp = resumir(linhas)

  // Parametros que atravessam links (periodo, aba, filtros, ordenacao, busca).
  const base: Record<string, string> = {
    ini: p.ini, fim: p.fim, aba: p.aba, tipo: p.tipos.join(','), familia: p.familias.join(','),
    situacao: p.situacao === 'validas' ? '' : p.situacao, q: p.q, ordem: p.ordem === 'valor' ? '' : p.ordem, sentido: p.sentido === 'mais' ? '' : p.sentido,
  }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/faturamento${q.size ? `?${q}` : ''}`
  }

  const dim = POR_ABA[p.aba]
  const rankingTodos = dim ? rankear(linhas, dim) : []
  const ranking = dim ? ordenarRanking(filtrarPorNome(rankingTodos, p.q), p.ordem, p.sentido) : []
  const selecionado = p.aba === 'produtos' && p.produto ? rankingTodos.find((r) => r.chave === p.produto) : undefined
  const serieSel = selecionado ? serieDiaria(linhas.filter((l) => (l.idProduto != null ? String(l.idProduto) : `nome:${l.produto}`) === p.produto), p.ini, p.fim) : []
  const serie = serieDiaria(linhas, p.ini, p.fim)

  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chipAtivo = `${chipBase} bg-brand-fill text-white`
  const chipInativo = `${chipBase} bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text`
  const exportQs = new URLSearchParams(Object.entries(base).filter(([, v]) => v)).toString()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Faturamento"
        icon={DollarSign}
        voltarHref="/relatorios"
        description="Escolha o período, filtre e veja o que mais vendeu."
        actions={
          <>
            <Link href="/relatorio-faturamento" className={btnClass('outline')}>Evolução mensal, forma de pgto e cupons</Link>
            {p.aba !== 'dias' && <a href={`/faturamento/export?${exportQs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}><Download className="size-4" /> Baixar</a>}
          </>
        }
      />

      <PeriodoBar basePath="/faturamento" params={{ ...base, produto: '' }} ini={p.ini} fim={p.fim} hoje={hoje} />
      <FiltrosFaturamento tipos={opcoes.tipos} familias={opcoes.familias} />

      {p.cortado && <p className="text-[13px] text-text-muted">Período limitado a 366 dias: mostrando os dias mais recentes.</p>}
      {aviso && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{aviso}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card titulo="Faturado" valor={<Money value={kp.faturado} />} />
        <Card titulo="Cupons" valor={kp.cupons.toLocaleString('pt-BR')} sub={`${kp.itens.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} itens vendidos`} />
        <Card titulo="Ticket médio" valor={kp.ticket == null ? '—' : <Money value={kp.ticket} />} />
        <Card titulo="Melhor dia" valor={kp.melhorDia ? <Money value={kp.melhorDia.valor} /> : '—'} sub={kp.melhorDia ? fmtDM(kp.melhorDia.dia) : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {ABAS.map((a) => <Link key={a.value} href={href({ aba: a.value, produto: '' })} className={p.aba === a.value ? chipAtivo : chipInativo}>{a.label}</Link>)}
      </div>

      {linhas.length === 0 ? (
        <EmptyState icon={DollarSign} title="Sem vendas no período" hint="Mude o período ou limpe os filtros de tipo, família e situação." />
      ) : p.aba === 'dias' ? (
        <div className="space-y-3">
          <BarrasDiarias dias={serie} hoje={hoje} />
          <TabelaDiaria dias={[...serie].reverse()} hoje={hoje} />
        </div>
      ) : (
        <div className="space-y-3">
          {selecionado && (
            <DetalheProduto item={selecionado} posicao={posicaoNoRanking(rankingTodos, selecionado.chave)} total={rankingTodos.length} serie={serieSel} hoje={hoje} fecharHref={href({ produto: '' })} />
          )}
          <form action="/faturamento" className="flex flex-wrap items-center gap-2">
            {Object.entries(base).filter(([k, v]) => v && !['q', 'ordem', 'sentido'].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={p.q} placeholder={`Buscar ${p.aba === 'produtos' ? 'produto' : p.aba === 'familias' ? 'família' : 'tipo'}…`} className="h-9 w-60 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text" />
            <input type="hidden" name="ordem" value={p.ordem === 'valor' ? '' : p.ordem} />
            <input type="hidden" name="sentido" value={p.sentido === 'mais' ? '' : p.sentido} />
            <button type="submit" className={chipInativo}>Buscar</button>
            <Link href={href({ sentido: '' })} className={p.sentido === 'mais' ? chipAtivo : chipInativo}>Mais vendidos</Link>
            <Link href={href({ sentido: 'menos' })} className={p.sentido === 'menos' ? chipAtivo : chipInativo}>Menos vendidos</Link>
            <span className="text-[12px] text-text-muted">por</span>
            <Link href={href({ ordem: '' })} className={p.ordem === 'valor' ? chipAtivo : chipInativo}>R$</Link>
            <Link href={href({ ordem: 'quant' })} className={p.ordem === 'quant' ? chipAtivo : chipInativo}>Quantidade</Link>
          </form>
          {ranking.length === 0 ? (
            <EmptyState icon={DollarSign} title="Nada encontrado" hint="Nenhum item bate com a busca." />
          ) : (
            <RankingBarras linhas={ranking} ordem={p.ordem} selecionado={p.produto} hrefDe={p.aba === 'produtos' ? (chave) => href({ produto: chave }) : undefined} />
          )}
        </div>
      )}
    </div>
  )
}

function Card({ titulo, valor, sub }: { titulo: string; valor: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="text-[13px] text-text-muted">{titulo}</div>
      <div className="num mt-1 text-[22px] font-semibold leading-none tracking-[-0.02em] text-text">{valor}</div>
      {sub && <div className="mt-1.5 text-[12px] text-text-muted">{sub}</div>}
    </div>
  )
}
