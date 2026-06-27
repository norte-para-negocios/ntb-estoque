import Link from 'next/link'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import {
  Wallet, AlertTriangle, Clock, CheckCircle2, TrendingDown, TrendingUp, Package,
} from 'lucide-react'

type SearchParams = Promise<{ status?: string; aba?: string }>

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
  ATRASADO: 'bg-danger/10 text-danger border-danger/30',
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

  const sb = await createClient()

  // Dados CP
  let cpQuery = sb.from('contas_pagar')
    .select('codigo_lancamento_omie,codigo_cliente_fornecedor,data_vencimento,data_previsao,valor_documento,status_titulo,codigo_tipo_documento,numero_documento,numero_parcela')
    .eq('loja_id', lojaId)
    .order('data_vencimento', { ascending: true })
  if (filtroStatus) cpQuery = cpQuery.eq('status_titulo', filtroStatus)

  // Dados CR
  let crQuery = sb.from('contas_receber')
    .select('codigo_lancamento_omie,codigo_cliente_fornecedor,data_vencimento,valor_documento,status_titulo,numero_documento')
    .eq('loja_id', lojaId)
    .order('data_vencimento', { ascending: true })
  if (filtroStatus) crQuery = crQuery.eq('status_titulo', filtroStatus)

  let cpCountQ = sb.from('contas_pagar').select('*', { count: 'exact', head: true }).eq('loja_id', lojaId)
  let crCountQ = sb.from('contas_receber').select('*', { count: 'exact', head: true }).eq('loja_id', lojaId)
  if (filtroStatus) { cpCountQ = cpCountQ.eq('status_titulo', filtroStatus); crCountQ = crCountQ.eq('status_titulo', filtroStatus) }

  const [cpRes, crRes, syncAtRes, cpCountRes, crCountRes] = await Promise.all([
    cpQuery.limit(500),
    crQuery.limit(500),
    sb.from('contas_pagar').select('synced_at').eq('loja_id', lojaId).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    cpCountQ,
    crCountQ,
  ])

  const cpAll = cpRes.data ?? []
  const crAll = crRes.data ?? []
  const cpCount = cpCountRes.count ?? cpAll.length
  const crCount = crCountRes.count ?? crAll.length
  const syncAt = syncAtRes.data?.synced_at
    ? new Date(syncAtRes.data.synced_at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

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
  const chipBase = (v: string) => `?aba=${aba}${v ? `&status=${v}` : ''}`

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
        <MoneyCard label="Atrasado (pagar)" value={totalAtrasCP} icon={AlertTriangle} cor="var(--danger)" />
        <MoneyCard label="Vence hoje" value={totalHojeCP} icon={Clock} cor="var(--warn)" />
        <MoneyCard label="A receber" value={totalCR} icon={TrendingUp} cor="var(--ok)" />
      </div>

      {/* Abas */}
      <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 w-fit">
        {(['pagar', 'receber'] as const).map(a => (
          <Link
            key={a}
            href={`?aba=${a}${filtroStatus ? `&status=${filtroStatus}` : ''}`}
            className={`rounded-md px-4 py-1.5 text-sm font-medium u-motion ${aba === a ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}
          >
            {a === 'pagar' ? `A Pagar (${cpCount})` : `A Receber (${crCount})`}
          </Link>
        ))}
      </div>

      {/* Chips de status */}
      <div className="flex flex-wrap gap-2">
        {CHIPS.map(chip => {
          const active = filtroStatus === chip.value
          return (
            <Link
              key={chip.value}
              href={chipBase(chip.value)}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium u-motion u-press-sm ${
                active ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'
              }`}
            >
              {chip.label}
            </Link>
          )
        })}
      </div>

      {/* Tabela */}
      {lista.length === 0 ? (
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
                    <td className={`px-3 py-2.5 text-right font-semibold num ${overdue ? 'text-danger' : 'text-text'}`}>
                      <Money value={Number(item.valor_documento)} />
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${cor}`}>
                        {STATUS_LABEL[item.status_titulo] ?? item.status_titulo}
                      </span>
                    </td>
                    <td className={`hidden px-3 py-2.5 text-right sm:table-cell num ${overdue ? 'text-danger font-semibold' : 'text-text-muted'}`}>
                      {dias !== null ? (dias < 0 ? `${Math.abs(dias)}d atras` : dias === 0 ? 'Hoje' : `${dias}d`) : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
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
