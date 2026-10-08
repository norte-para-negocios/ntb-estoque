import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Flag } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { carregarFaturamentoDiario } from '@/lib/faturamento-diario'
import { diasDoMes, resumirMes, resumirSemanas, semanasDoMes } from '@/lib/meta-mensal'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'
import { TabelaDiaria } from '@/components/faturamento/TabelaDiaria'
import { BarraProgresso } from '@/components/faturamento/BarraProgresso'
import { FormMetaMensal } from '@/components/faturamento/FormMetaMensal'

const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const fmtDM = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const nomeMes = (mes: string) => {
  const s = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function mesAnterior(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 - n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function MetaMensalPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const mesAtual = hoje.slice(0, 7)
  // So mes atual ou passado: nao ha o que comparar com o futuro.
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? '') && sp.mes! <= mesAtual ? sp.mes! : mesAtual
  const ultimoDia = `${mes}-${String(diasDoMes(mes)).padStart(2, '0')}`

  const supabase = createServiceClient()
  const { data: metaRow } = await supabase.from('metas_mensais').select('valor_mensal').eq('loja_id', lojaId).eq('mes', mes).maybeSingle()
  const meta = metaRow?.valor_mensal != null ? Number(metaRow.valor_mensal) : null

  const fat = meta != null ? await carregarFaturamentoDiario(lojaId, `${mes}-01`, ultimoDia > hoje ? hoje : ultimoDia) : null
  const r = fat && meta != null ? resumirMes({ mes, meta, dias: fat.dias, hoje }) : null
  const semanas = r && fat ? resumirSemanas(semanasDoMes(mes), fat.dias, r.metaDiaria, hoje) : []

  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chipAtivo = `${chipBase} bg-brand-fill text-white`
  const chipInativo = `${chipBase} bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text`
  const meses = Array.from({ length: 6 }, (_, i) => mesAnterior(mesAtual, i))
  const noMesAtual = mes === mesAtual

  return (
    <div className="space-y-4">
      <PageHeader title="Meta do mês" icon={Flag} voltarHref="/relatorios" description="Quanto já foi, quanto falta e quanto precisa vender por dia para fechar a meta do mês." />

      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
        {meses.map((m) => (
          <Link key={m} href={m === mesAtual ? '/meta-mensal' : `/meta-mensal?mes=${m}`} className={m === mes ? chipAtivo : chipInativo}>{nomeMes(m)}</Link>
        ))}
      </div>

      <FormMetaMensal key={mes} mes={mes} valorInicial={meta} rotuloMes={nomeMes(mes)} />

      {meta == null || !r || !fat ? (
        <EmptyState icon={Flag} title="Defina a meta do mês" hint={`Digite quanto a loja quer faturar em ${nomeMes(mes)} e salve. A tela divide pelos dias do mês e acompanha o progresso.`} />
      ) : (
        <>
          {fat.aviso && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{fat.aviso}</p>}

          <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-[13px] text-text-muted">Faturado em {nomeMes(mes)}</div>
                <div className="num text-[28px] font-semibold leading-none tracking-[-0.02em] text-text"><Money value={r.realizado} /></div>
              </div>
              <div className="text-right">
                <div className="text-[13px] text-text-muted">Meta do mês</div>
                <div className="num text-[18px] font-semibold text-text"><Money value={meta} /></div>
              </div>
            </div>
            <BarraProgresso pct={r.pct} marcadorPct={noMesAtual ? r.pctEsperado : undefined} altura="h-4" rotulo="Progresso da meta do mês" />
            <div className="flex flex-wrap justify-between gap-2 text-[13px] text-text-muted">
              <span><strong className="text-text">{fmtPct(r.pct)}</strong> da meta</span>
              {noMesAtual && <span>traço laranja: onde deveria estar hoje ({fmtPct(r.pctEsperado)})</span>}
            </div>
            <p className="text-[14px] font-semibold text-text">
              {r.superou
                ? `Meta do mês batida: ${fmtMoeda(r.realizado - meta)} acima.`
                : `Faltam ${fmtMoeda(r.falta)} para a meta${noMesAtual ? ` em ${r.diasRestantes} dia(s), contando hoje.` : '.'}`}
            </p>
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card titulo="Meta por dia" valor={<Money value={r.metaDiaria} />} sub={`${fmtMoeda(meta)} ÷ ${r.diasNoMes} dias`} />
            <Card titulo="Falta" valor={<Money value={r.falta} />} sub={r.superou ? 'meta batida' : `${fmtPct(r.pct == null ? null : 100 - r.pct)} da meta`} />
            <Card
              titulo="Precisa vender por dia"
              valor={r.precisaPorDia == null ? '—' : <Money value={r.precisaPorDia} />}
              sub={noMesAtual && !r.superou ? `nos ${r.diasRestantes} dias que restam` : undefined}
            />
            <Card
              titulo={noMesAtual ? 'Projeção do mês' : 'Fechamento'}
              valor={r.projecao == null ? '—' : <Money value={r.projecao} />}
              sub={r.media == null ? 'sem dia fechado ainda' : `média de ${fmtMoeda(r.media)} por dia`}
            />
          </div>

          {noMesAtual && r.diasFechados > 0 && (
            <p className={`text-[13px] font-semibold ${r.diferencaRitmo >= 0 ? 'text-ok' : 'text-warn'}`}>
              {r.diferencaRitmo >= 0
                ? `Adiantado: ${fmtMoeda(r.diferencaRitmo)} acima do ritmo da meta nos ${r.diasFechados} dia(s) fechado(s).`
                : `Atrasado: ${fmtMoeda(-r.diferencaRitmo)} abaixo do ritmo da meta nos ${r.diasFechados} dia(s) fechado(s).`}
            </p>
          )}

          <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
            <h2 className="text-[14px] font-semibold text-text">Por semana</h2>
            {semanas.map((s, i) => (
              <div key={s.ini} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                  <span className="font-semibold text-text">
                    Semana {i + 1} <span className="font-normal text-text-muted">· {fmtDM(s.ini)} a {fmtDM(s.fim)} ({s.nDias} dias)</span>
                  </span>
                  <span className="text-text-muted">
                    <Money value={s.realizado} /> de <Money value={s.meta} /> · <strong className="text-text">{fmtPct(s.situacao === 'futura' ? null : s.pct)}</strong>
                    {s.situacao === 'andamento' && ' · em andamento'}
                    {s.situacao === 'futura' && ' · ainda não começou'}
                  </span>
                </div>
                <BarraProgresso pct={s.situacao === 'futura' ? 0 : s.pct} rotulo={`Semana ${i + 1}`} cor={s.situacao === 'fechada' && (s.pct ?? 0) < 100 ? 'bg-brand/40' : 'bg-brand'} />
              </div>
            ))}
          </section>

          <BarrasDiarias dias={fat.dias} meta={r.metaDiaria} hoje={hoje} />
          <TabelaDiaria dias={[...fat.dias].reverse()} meta={r.metaDiaria} hoje={hoje} />
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
