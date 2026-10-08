import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Target, Download } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { carregarFaturamentoDiario } from '@/lib/faturamento-diario'
import { periodoDoAtalho, resumirMeta, type Atalho } from '@/lib/meta-faturamento'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'
import { TabelaDiaria } from '@/components/faturamento/TabelaDiaria'
import { FormMeta } from '@/components/faturamento/FormMeta'

const ATALHOS: { value: Atalho; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes', label: 'Este mês' },
]
const ISO = /^\d{4}-\d{2}-\d{2}$/
const fmtData = (iso: string) => iso.split('-').reverse().join('/')
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function RelatorioMetaPage({
  searchParams,
}: {
  searchParams: Promise<{ atalho?: string; data_inicio?: string; data_final?: string }>
}) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const sp = await searchParams
  const hoje = hojeBahiaISO()

  // Periodo: datas livres tem prioridade; senao atalho; default = este mes.
  const custom = ISO.test(sp.data_inicio ?? '') && sp.data_inicio! <= hoje
  const atalho: Atalho | null = custom ? null : (ATALHOS.some((a) => a.value === sp.atalho) ? (sp.atalho as Atalho) : 'mes')
  const base = atalho ? periodoDoAtalho(atalho, hoje) : { ini: sp.data_inicio!, fim: ISO.test(sp.data_final ?? '') ? sp.data_final! : hoje }
  const ini = base.ini
  const fim = base.fim > hoje ? hoje : base.fim < ini ? ini : base.fim

  const supabase = createServiceClient()
  const { data: metaRow } = await supabase.from('metas_faturamento').select('valor_diario').eq('loja_id', lojaId).maybeSingle()
  const meta = metaRow?.valor_diario != null ? Number(metaRow.valor_diario) : null

  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chipAtivo = `${chipBase} bg-brand-fill text-white`
  const chipInativo = `${chipBase} bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text`

  const fat = meta != null ? await carregarFaturamentoDiario(lojaId, ini, fim) : null
  const resumo = fat && meta != null ? resumirMeta(fat.dias, meta, hoje) : null
  const qs = new URLSearchParams({ data_inicio: ini, data_final: fim }).toString()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Meta de faturamento"
        icon={Target}
        voltarHref="/relatorios"
        description="Defina a meta diária e veja se o faturamento bateu, dia a dia."
        actions={meta != null ? (
          <a href={`/relatorio-meta/export?${qs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}>
            <Download className="size-4" /> Baixar
          </a>
        ) : undefined}
      />

      <FormMeta valorInicial={meta} />

      {meta == null ? (
        <EmptyState icon={Target} title="Defina a meta diária" hint="Informe quanto a loja quer faturar por dia e salve. Depois escolha o período para comparar." />
      ) : (
        <>
          <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
            {ATALHOS.map((a) => (
              <Link key={a.value} href={`/relatorio-meta?atalho=${a.value}`} className={atalho === a.value ? chipAtivo : chipInativo}>{a.label}</Link>
            ))}
            <form action="/relatorio-meta" className="flex items-center gap-1.5 text-[13px] text-text-muted">
              <input type="date" name="data_inicio" defaultValue={ini} max={hoje} className="h-8 rounded-[var(--r-md)] border border-border bg-surface px-2 text-text" />
              <span>a</span>
              <input type="date" name="data_final" defaultValue={fim} max={hoje} className="h-8 rounded-[var(--r-md)] border border-border bg-surface px-2 text-text" />
              <button type="submit" className={custom ? chipAtivo : chipInativo}>Aplicar</button>
            </form>
          </div>

          <p className="text-[13px] text-text-muted">Período: {fmtData(ini)} a {fmtData(fim)} · meta diária <Money value={meta} /></p>

          {fat?.aviso && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{fat.aviso}</p>}

          {resumo && fat && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card titulo="Realizado" valor={<Money value={resumo.realizado} />} sub={`meta do período: ${fmtMoeda(resumo.metaPeriodo)}`} />
                <Card titulo="% da meta" valor={resumo.pctAtingido == null ? '—' : `${resumo.pctAtingido.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} sub={`${resumo.diasFechados} dia(s) fechado(s)`} />
                <Card titulo="Média por dia" valor={resumo.media == null ? '—' : <Money value={resumo.media} />} sub={resumo.melhor && resumo.pior ? `melhor: ${fmtData(resumo.melhor.dia)} · pior: ${fmtData(resumo.pior.dia)}` : undefined} />
                <Card titulo="Dias que bateram" valor={`${resumo.diasBateram} de ${resumo.diasFechados}`} sub={resumo.emAndamento ? `hoje (em andamento): ${fmtMoeda(resumo.emAndamento.valor)}` : undefined} />
              </div>
              {fat.dias.length > 0 ? (
                <>
                  <BarrasDiarias dias={fat.dias} meta={meta} hoje={hoje} />
                  <TabelaDiaria dias={[...fat.dias].reverse()} meta={meta} hoje={hoje} />
                </>
              ) : (
                <EmptyState icon={Target} title="Sem dados no período" hint="Escolha outro período." />
              )}
            </>
          )}
        </>
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
