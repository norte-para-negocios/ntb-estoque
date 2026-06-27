import Link from 'next/link'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import {
  Wallet, AlertTriangle, Clock, CheckCircle2, TrendingDown, TrendingUp, Package, Landmark,
} from 'lucide-react'
import { FluxoChart } from './FluxoChart'

type SearchParams = Promise<{ status?: string; aba?: string; dias?: string; tipo?: string }>

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function diasAte(venc: string | null): number | null {
  if (!venc) return null
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const [y, m, day] = venc.split('-')
  const v = new Date(Number(y), Number(m) - 1, Number(day))
  v.setHours(0, 0, 0, 0)
  return Math.round((v.getTime() - hoje.getTime()) / 86400000)
}

const STATUS_LABEL: Record<string, string> = {
  EMABERTO: 'Em aberto',
  ATRASADO: 'Atrasado',
  AVENCER: 'A vencer',
  VENCEHOJE: 'Vence hoje',
  PAGTO_PARCIAL: 'Parcial',
}

const STATUS_COR: Record<string, string> = {
  ATRASADO: 'bg-err/10 text-err border-err/30',
  VENCEHOJE: 'bg-warn/10 text-warn border-warn/30',
  AVENCER: 'bg-ok/10 text-ok border-ok/30',
  EMABERTO: 'bg-surface-2 text-text-muted border-border',
  PAGTO_PARCIAL: 'bg-brand/10 text-brand border-brand/30',
}

const CHIPS = [
  { value: '', label: 'Todos' },
  { value: 'ATRASADO', label: 'Atrasados' },
  { value: 'VENCEHOJE', label: 'Hoje' },
  { value: 'AVENCER', label: 'A vencer' },
  { value: 'EMABERTO', label: 'Em aberto' },
]

export default async function FinanceiroPage({ searchParams }: { searchParams: SearchParams }) {
  const [profile, sp] = await Promise.all([getProfile(), searchParams])
  const lojaId = profile.current_loja_id

  if (!lojaId) {
    return <EmptyState icon={Package} title="Selecione uma loja" hint="Escolha uma loja para ver o financeiro." />
  }

  const aba = sp.aba ?? 'pagar'
  const filtroStatus = sp.status ?? ''
  const filtroDias = sp.dias ?? ''
  const filtroTipo = sp.tipo ?? ''

  // Data limite para filtro de prazo
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const dataLimite = filtroDias ? new Date(hoje.getTime() + Number(filtroDias) * 86400000).toISOString().slice(0, 10) : null
  const dataHoje = hoje.toISOString().slice(0, 10)

  const sb = await createClient()

  // Dados CP
  let cpQuery = sb.from('contas_pagar')
    .select('codigo_lancamento_omie,codigo_cliente_fornecedor,data_vencimento,data_previsao,valor_documento,status_titulo,codigo_tipo_documento,numero_documento,numero_parcela')
    .eq('loja_id', lojaId)
    .order('data_vencimento', { ascending: true })
  if (filtroStatus) cpQuery = cpQuery.eq('status_titulo', filtroStatus)
  if (filtroTipo) cpQuery = cpQuery.eq('codigo_tipo_documento', filtroTipo)
  if (dataLimite) { cpQuery = cpQuery.gte('data_vencimento', dataHoje).lte('data_vencimento', dataLimite) }

  // Dados CR
  let crQuery = sb.from('contas_receber')
    .select('codigo_lancamento_omie,codigo_cliente_fornecedor,data_vencimento,valor_documento,status_titulo,numero_documento')
    .eq('loja_id', lojaId)
    .order('data_vencimento', { ascending: true })
  if (filtroStatus) crQuery = crQuery.eq('status_titulo', filtroStatus)
  if (dataLimite) { crQuery = crQuery.gte('data_vencimento', dataHoje).lte('data_vencimento', dataLimite) }

  let cpCountQ = sb.from('contas_pagar').select('*', { count: 'exact', head: true }).eq('loja_id', lojaId)
  let crCountQ = sb.from('contas_receber').select('*', { count: 'exact', head: true }).eq('loja_id', lojaId)
  if (filtroStatus) { cpCountQ = cpCountQ.eq('status_titulo', filtroStatus); crCountQ = crCountQ.eq('status_titulo', filtroStatus) }
  if (filtroTipo) cpCountQ = cpCountQ.eq('codigo_tipo_documento', filtroTipo)
  if (dataLimite) { cpCountQ = cpCountQ.gte('data_vencimento', dataHoje).lte('data_vencimento', dataLimite); crCountQ = crCountQ.gte('data_vencimento', dataHoje).lte('data_vencimento', dataLimite) }

  const [cpRes, crRes, syncAtRes, cpCountRes, crCountRes, tiposRes, crResumoRes, ccRes, fluxoRes] = await Promise.all([
    cpQuery.limit(500),
    crQuery.limit(500),
    sb.from('contas_pagar').select('synced_at').eq('loja_id', lojaId).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    cpCountQ,
    crCountQ,
    sb.from('contas_pagar').select('codigo_tipo_documento').eq('loja_id', lojaId).not('codigo_tipo_documento', 'is', null),
    sb.rpc('financeiro_resumo_cr', { p_loja_id: lojaId }),
    sb.from('contas_correntes').select('descricao,tipo,tipo_descricao,saldo_atual,saldo_disponivel').eq('loja_id', lojaId).order('saldo_atual', { ascending: false }),
    sb.rpc('financeiro_fluxo_caixa', { p_loja_id: lojaId }),
  ])

  const cpAll = cpRes.data ?? []
  const crAll = crRes.data ?? []
  const cpCount = cpCountRes.count ?? cpAll.length
  const crCount = crCountRes.count ?? crAll.length
  const tipos = [...new Set((tiposRes.data ?? []).map((r: { codigo_tipo_documento: string }) => r.codigo_tipo_documento).filter(Boolean))].sort()

  // Resumo CR por mes via RPC (GROUP BY no banco)
  const crResumo = (crResumoRes.data ?? []).map((r: { mes: string; total: string | number; n: string | number; atrasado: string | number }) => ({
    mes: r.mes as string,
    total: Number(r.total),
    n: Number(r.n),
    atrasado: Number(r.atrasado),
  }))
  const syncAt = syncAtRes.data?.synced_at
    ? new Date(syncAtRes.data.synced_at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  // B.3.5 Posicao de caixa: contas correntes com saldo
  const contasCorrentes = (ccRes.data ?? []).map((c: { descricao: string | null; tipo: string | null; tipo_descricao: string | null; saldo_atual: string | number | null; saldo_disponivel: string | number | null }) => ({
    descricao: c.descricao ?? 'Sem nome',
    tipo: c.tipo ?? '',
    saldo: Number(c.saldo_atual ?? 0),
    disponivel: Number(c.saldo_disponivel ?? 0),
  }))
  const ccComSaldo = contasCorrentes.filter(c => c.saldo !== 0)
  const saldoCaixa = contasCorrentes.reduce((s, c) => s + c.saldo, 0)

  // B.3.5 Fluxo projetado: entradas x saidas por mes; acumulado parte do caixa atual
  const mesAtual = dataHoje.slice(0, 7)
  const fluxoRaw: { mes: string; entradas: number; saidas: number; saldoMes: number }[] = (fluxoRes.data ?? []).map((r: { mes: string; entradas: string | number; saidas: string | number; saldo_mes: string | number }) => ({
    mes: r.mes,
    entradas: Number(r.entradas),
    saidas: Number(r.saidas),
    saldoMes: Number(r.saldo_mes),
  }))
  // Vencidos: meses anteriores ao atual (atrasados que ainda nao liquidaram)
  const fluxoVencido = fluxoRaw.filter(f => f.mes < mesAtual)
  const fluxoFuturo = fluxoRaw.filter(f => f.mes >= mesAtual)
  let acum = saldoCaixa
  const fluxoProjetado = fluxoFuturo.map(f => { acum += f.saldoMes; return { ...f, acumulado: acum } })
  const totalVencidoEntra = fluxoVencido.reduce((s, f) => s + f.entradas, 0)
  const totalVencidoSai = fluxoVencido.reduce((s, f) => s + f.saidas, 0)

  // Totalizadores globais (sem filtro de status nos cards)
  const [cpTotRes, crTotRes] = await Promise.all([
    sb.from('contas_pagar').select('valor_documento,status_titulo').eq('loja_id', lojaId),
    sb.from('contas_receber').select('valor_documento,status_titulo').eq('loja_id', lojaId),
  ])
  const cpTot = cpTotRes.data ?? []
  const crTot = crTotRes.data ?? []

  const totalCP = cpTot.reduce((s, i) => s + Number(i.valor_documento ?? 0), 0)
  const totalAtrasCP = cpTot.filter(i => i.status_titulo === 'ATRASADO').reduce((s, i) => s + Number(i.valor_documento ?? 0), 0)
  const totalHojeCP = cpTot.filter(i => i.status_titulo === 'VENCEHOJE').reduce((s, i) => s + Number(i.valor_documento ?? 0), 0)
  const totalCR = crTot.reduce((s, i) => s + Number(i.valor_documento ?? 0), 0)

  const lista = aba === 'pagar' ? cpAll : crAll

  function qs(overrides: Record<string, string>) {
    const p: Record<string, string> = { aba }
    if (filtroStatus) p.status = filtroStatus
    if (filtroDias) p.dias = filtroDias
    if (filtroTipo) p.tipo = filtroTipo
    Object.entries(overrides).forEach(([k, v]) => { if (v) p[k] = v; else delete p[k] })
    return '?' + new URLSearchParams(p).toString()
  }

  if (!cpTot.length && !crTot.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="Financeiro" icon={Wallet} description="Contas a pagar e receber sincronizadas do Omie." />
        <EmptyState icon={Clock} title="Sincronizando..." hint="Aguarde o primeiro sync. Rode: node scripts/sync-financeiro.mjs" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        icon={Wallet}
        description={syncAt ? `Ultima sincronizacao: ${syncAt}` : 'Dados do Omie (itens em aberto).'}
      />

      {/* Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MoneyCard label="A pagar (total)" value={totalCP} icon={TrendingDown} cor="var(--text-muted)" />
        <MoneyCard label="Atrasado (pagar)" value={totalAtrasCP} icon={AlertTriangle} cor="var(--err)" />
        <MoneyCard label="Vence hoje" value={totalHojeCP} icon={Clock} cor="var(--warn)" />
        <MoneyCard label="A receber" value={totalCR} icon={TrendingUp} cor="var(--ok)" />
      </div>

      {/* Abas */}
      <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 w-fit">
        {(['pagar', 'receber', 'fluxo'] as const).map(a => (
          <Link
            key={a}
            href={a === 'fluxo' ? '?aba=fluxo' : qs({ aba: a, dias: a === 'receber' ? '' : filtroDias, tipo: a === 'receber' ? '' : filtroTipo })}
            className={`rounded-md px-4 py-1.5 text-sm font-medium u-motion ${aba === a ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}
          >
            {a === 'pagar' ? `A Pagar (${cpCount})` : a === 'receber' ? `A Receber (${crCount})` : 'Fluxo de caixa'}
          </Link>
        ))}
      </div>

      {/* Chips de status */}
      {aba !== 'fluxo' && (
        <div className="flex flex-wrap gap-2">
          {CHIPS.map(chip => {
            const active = filtroStatus === chip.value
            return (
              <Link key={chip.value} href={qs({ status: chip.value })}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium u-motion u-press-sm ${active ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'}`}
              >{chip.label}</Link>
            )
          })}
        </div>
      )}

      {/* Chips de prazo (so CP) */}
      {aba === 'pagar' && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-text-muted">Vence em:</span>
          {[{ v: '', l: 'Qualquer' }, { v: '7', l: '7 dias' }, { v: '30', l: '30 dias' }, { v: '90', l: '90 dias' }].map(({ v, l }) => (
            <Link key={v} href={qs({ dias: v })}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium u-motion u-press-sm ${filtroDias === v ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'}`}
            >{l}</Link>
          ))}
          {tipos.length > 0 && (
            <>
              <span className="text-[11px] text-text-muted ml-3">Tipo:</span>
              <Link href={qs({ tipo: '' })}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium u-motion u-press-sm ${!filtroTipo ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'}`}
              >Todos</Link>
              {tipos.map(t => (
                <Link key={t} href={qs({ tipo: t })}
                  className={`rounded-full border px-3 py-1 text-[12px] font-medium u-motion u-press-sm ${filtroTipo === t ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'}`}
                >{t}</Link>
              ))}
            </>
          )}
        </div>
      )}

      {/* Tabela */}
      {aba !== 'fluxo' && (lista.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nenhum item" hint={filtroStatus ? 'Sem itens com esse status.' : 'Nenhuma conta em aberto.'} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Documento</th>
                <th className="hidden px-3 py-2.5 text-left font-semibold text-text-muted sm:table-cell">Vencimento</th>
                <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Valor</th>
                <th className="hidden px-3 py-2.5 text-left font-semibold text-text-muted sm:table-cell">Status</th>
                <th className="hidden px-3 py-2.5 text-right font-semibold text-text-muted sm:table-cell">Dias</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lista.map((item) => {
                const dias = diasAte(item.data_vencimento)
                const overdue = (dias ?? 0) < 0
                const cor = STATUS_COR[item.status_titulo] ?? STATUS_COR.EMABERTO
                return (
                  <tr key={item.codigo_lancamento_omie} className="hover:bg-surface-2/50">
                    <td className="px-3 py-2.5">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(() => { const it = item as any; return (<>
                        <span className="font-medium text-text">{it.numero_documento || '-'}</span>
                        {it.numero_parcela ? <span className="ml-1.5 text-[11px] text-text-muted">{it.numero_parcela}</span> : null}
                        {it.codigo_tipo_documento ? <span className="ml-1.5 text-[10px] text-text-muted/60">{it.codigo_tipo_documento}</span> : null}
                      </>) })()}
                    </td>
                    <td className="hidden px-3 py-2.5 text-text-muted sm:table-cell">
                      {fmtData(item.data_vencimento)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-semibold num ${overdue ? 'text-err' : 'text-text'}`}>
                      <Money value={Number(item.valor_documento)} />
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${cor}`}>
                        {STATUS_LABEL[item.status_titulo] ?? item.status_titulo}
                      </span>
                    </td>
                    <td className={`hidden px-3 py-2.5 text-right sm:table-cell num ${overdue ? 'text-err font-semibold' : 'text-text-muted'}`}>
                      {dias !== null ? (dias < 0 ? `${Math.abs(dias)}d atras` : dias === 0 ? 'Hoje' : `${dias}d`) : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* B.3.5 Fluxo de caixa */}
      {aba === 'fluxo' && (
        <FluxoCaixa
          saldoCaixa={saldoCaixa}
          totalCP={totalCP}
          totalCR={totalCR}
          ccComSaldo={ccComSaldo}
          fluxoProjetado={fluxoProjetado}
          fluxoVencido={fluxoVencido}
          totalVencidoEntra={totalVencidoEntra}
          totalVencidoSai={totalVencidoSai}
        />
      )}

      {/* B.3.4 Resumo CR por mes */}
      {aba === 'receber' && crResumo.length > 0 && !filtroDias && !filtroStatus && (
        <div>
          <h3 className="mb-3 text-[13px] font-semibold text-text">Resumo por vencimento</h3>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Mes</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Qtd</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Total</th>
                  <th className="hidden px-3 py-2.5 text-right font-semibold text-text-muted sm:table-cell">Atrasados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {crResumo.map(({ mes, total, n, atrasado }: { mes: string; total: number; n: number; atrasado: number }) => {
                  const [y, m] = mes.split('-')
                  const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                  const isPast = mes < dataHoje.slice(0, 7)
                  return (
                    <tr key={mes} className="hover:bg-surface-2/50">
                      <td className={`px-3 py-2.5 font-medium ${isPast ? 'text-err' : 'text-text'}`}>{label}</td>
                      <td className="px-3 py-2.5 text-right text-text-muted num">{n}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold num ${isPast ? 'text-err' : 'text-text'}`}>
                        <Money value={total} />
                      </td>
                      <td className="hidden px-3 py-2.5 text-right sm:table-cell">
                        {atrasado > 0 ? <span className="rounded-full bg-err/10 border border-err/30 px-2 py-0.5 text-[10px] font-medium text-err">{atrasado} atrasado{atrasado > 1 ? 's' : ''}</span> : <span className="text-text-muted">-</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function mesLabel(mes: string): string {
  const [y, m] = mes.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
}

function FluxoCaixa({
  saldoCaixa, totalCP, totalCR, ccComSaldo, fluxoProjetado, fluxoVencido, totalVencidoEntra, totalVencidoSai,
}: {
  saldoCaixa: number
  totalCP: number
  totalCR: number
  ccComSaldo: { descricao: string; tipo: string; saldo: number; disponivel: number }[]
  fluxoProjetado: { mes: string; entradas: number; saidas: number; saldoMes: number; acumulado: number }[]
  fluxoVencido: { mes: string; entradas: number; saidas: number; saldoMes: number }[]
  totalVencidoEntra: number
  totalVencidoSai: number
}) {
  const saldoProjetado = saldoCaixa + totalCR - totalCP
  const semCaixa = ccComSaldo.length === 0 && saldoCaixa === 0

  return (
    <div className="space-y-6">
      {/* Cards de posicao */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MoneyCard label="Saldo em caixa hoje" value={saldoCaixa} icon={Landmark} cor="var(--brand)" />
        <MoneyCard label="A receber (entradas)" value={totalCR} icon={TrendingUp} cor="var(--ok)" />
        <MoneyCard label="A pagar (saidas)" value={totalCP} icon={TrendingDown} cor="var(--err)" />
        <MoneyCard label="Saldo projetado" value={saldoProjetado} icon={Wallet} cor={saldoProjetado < 0 ? 'var(--err)' : 'var(--ok)'} />
      </div>

      {semCaixa && (
        <p className="text-[12px] text-text-muted">
          Posicao de caixa ainda nao sincronizada. Rode <code className="rounded bg-surface-2 px-1">node scripts/sync-financeiro.mjs</code> para puxar os saldos das contas correntes do Omie.
        </p>
      )}

      {/* Grafico de fluxo */}
      {fluxoProjetado.length > 0 && <FluxoChart dados={fluxoProjetado} />}

      {/* Vencidos (atrasados de meses passados) */}
      {(totalVencidoEntra > 0 || totalVencidoSai > 0) && (
        <div className="rounded-xl border border-warn/30 bg-warn/5 p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-warn">
            <AlertTriangle className="size-4" /> Em atraso (vencimento ja passou, ainda em aberto)
          </div>
          <div className="mt-2 flex flex-wrap gap-6 text-[13px]">
            <span>A receber atrasado: <strong className="text-ok num"><Money value={totalVencidoEntra} /></strong></span>
            <span>A pagar atrasado: <strong className="text-err num"><Money value={totalVencidoSai} /></strong></span>
            <span className="text-text-muted">{fluxoVencido.length} {fluxoVencido.length === 1 ? 'mes' : 'meses'}</span>
          </div>
        </div>
      )}

      {/* Posicao de caixa por conta */}
      {ccComSaldo.length > 0 && (
        <div>
          <h3 className="mb-3 text-[13px] font-semibold text-text">Posicao por conta</h3>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Conta</th>
                  <th className="hidden px-3 py-2.5 text-left font-semibold text-text-muted sm:table-cell">Tipo</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ccComSaldo.map((c, i) => (
                  <tr key={i} className="hover:bg-surface-2/50">
                    <td className="px-3 py-2.5 font-medium text-text">{c.descricao}</td>
                    <td className="hidden px-3 py-2.5 text-text-muted sm:table-cell">{TIPO_CC[c.tipo] ?? c.tipo}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold num ${c.saldo < 0 ? 'text-err' : 'text-text'}`}>
                      <Money value={c.saldo} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-surface-2">
                  <td className="px-3 py-2.5 font-semibold text-text" colSpan={2}>Total</td>
                  <td className={`px-3 py-2.5 text-right font-bold num ${saldoCaixa < 0 ? 'text-err' : 'text-text'}`}>
                    <Money value={saldoCaixa} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Projecao por mes */}
      <div>
        <h3 className="mb-3 text-[13px] font-semibold text-text">Projecao (mes atual em diante)</h3>
        {fluxoProjetado.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Sem projecao" hint="Nenhuma conta a vencer a partir deste mes." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Mes</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Entradas</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Saidas</th>
                  <th className="hidden px-3 py-2.5 text-right font-semibold text-text-muted sm:table-cell">Saldo do mes</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Acumulado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fluxoProjetado.map((f) => (
                  <tr key={f.mes} className="hover:bg-surface-2/50">
                    <td className="px-3 py-2.5 font-medium text-text capitalize">{mesLabel(f.mes)}</td>
                    <td className="px-3 py-2.5 text-right text-ok num">{f.entradas > 0 ? <Money value={f.entradas} /> : '-'}</td>
                    <td className="px-3 py-2.5 text-right text-err num">{f.saidas > 0 ? <Money value={f.saidas} /> : '-'}</td>
                    <td className={`hidden px-3 py-2.5 text-right sm:table-cell num ${f.saldoMes < 0 ? 'text-err' : 'text-text'}`}><Money value={f.saldoMes} /></td>
                    <td className={`px-3 py-2.5 text-right font-semibold num ${f.acumulado < 0 ? 'text-err' : 'text-text'}`}><Money value={f.acumulado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-text-muted">
          Acumulado parte do saldo em caixa de hoje e soma as entradas e saidas previstas por mes (pelo vencimento). Projecao, nao realizado.
        </p>
      </div>
    </div>
  )
}

const TIPO_CC: Record<string, string> = {
  CX: 'Caixa',
  CC: 'Conta corrente',
  AC: 'Cartao',
}

function MoneyCard({ label, value, icon: Icon, cor }: { label: string; value: number; icon: React.ElementType; cor: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-4">
      <div className="absolute inset-x-0 top-0 h-[2px] opacity-60" style={{ background: cor }} />
      <span className="flex size-8 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${cor} 12%, transparent)` }}>
        <Icon className="size-4" style={{ color: cor }} strokeWidth={2} />
      </span>
      <div className="mt-3 text-[1.4rem] font-semibold leading-none text-text num">
        <Money value={value} />
      </div>
      <div className="mt-1.5 text-[11px] text-text-muted">{label}</div>
    </div>
  )
}
