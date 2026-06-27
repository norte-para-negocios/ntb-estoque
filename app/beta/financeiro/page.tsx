import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import {
  Wallet, AlertTriangle, Clock, CheckCircle2, TrendingDown, TrendingUp, Package,
} from 'lucide-react'

function parseBR(d: string | null): Date | null {
  if (!d) return null
  const [y, m, day] = d.split('-')
  return new Date(Number(y), Number(m) - 1, Number(day))
}

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function diasAte(venc: string | null): number | null {
  if (!venc) return null
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const v = parseBR(venc)
  if (!v) return null
  v.setHours(0, 0, 0, 0)
  return Math.round((v.getTime() - hoje.getTime()) / 86400000)
}

type CP = {
  codigo_lancamento_omie: number
  codigo_cliente_fornecedor: number | null
  data_vencimento: string | null
  data_previsao: string | null
  valor_documento: number
  status_titulo: string
  codigo_tipo_documento: string | null
  numero_documento: string | null
  numero_parcela: string | null
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

export default async function FinanceiroPage() {
  const profile = await getProfile()
  const lojaId = profile.current_loja_id

  if (!lojaId) {
    return <EmptyState icon={Package} title="Selecione uma loja" hint="Escolha uma loja para ver o financeiro." />
  }

  const sb = await createClient()

  const [cpRes, crRes] = await Promise.all([
    sb.from('contas_pagar')
      .select('codigo_lancamento_omie,codigo_cliente_fornecedor,data_vencimento,data_previsao,valor_documento,status_titulo,codigo_tipo_documento,numero_documento,numero_parcela')
      .eq('loja_id', lojaId)
      .order('data_vencimento', { ascending: true }),
    sb.from('contas_receber')
      .select('codigo_lancamento_omie,valor_documento,status_titulo,data_vencimento')
      .eq('loja_id', lojaId),
  ])

  const cp: CP[] = (cpRes.data ?? []) as CP[]
  const cr = crRes.data ?? []

  if (!cp.length && !cr.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="Financeiro" icon={Wallet} description="Contas a pagar e receber sincronizadas do Omie." />
        <EmptyState icon={Clock} title="Sincronizando..." hint="Aguarde o primeiro sync do financeiro. Rode: node scripts/sync-financeiro.mjs" />
      </div>
    )
  }

  // --- Totalizadores CP ---
  const cpAtrasado = cp.filter(i => i.status_titulo === 'ATRASADO')
  const cpHoje = cp.filter(i => i.status_titulo === 'VENCEHOJE')
  const cpAvencer = cp.filter(i => i.status_titulo !== 'ATRASADO' && i.status_titulo !== 'VENCEHOJE')

  const totalCP = cp.reduce((acc, i) => acc + Number(i.valor_documento ?? 0), 0)
  const totalAtrasado = cpAtrasado.reduce((acc, i) => acc + Number(i.valor_documento ?? 0), 0)
  const totalHoje = cpHoje.reduce((acc, i) => acc + Number(i.valor_documento ?? 0), 0)

  // --- Totalizadores CR ---
  const totalCR = cr.reduce((acc, i) => acc + Number(i.valor_documento ?? 0), 0)
  const crAtrasado = cr.filter(i => i.status_titulo === 'ATRASADO')
  const totalCRAtrasado = crAtrasado.reduce((acc, i) => acc + Number(i.valor_documento ?? 0), 0)

  // Data do último sync
  const syncAtRes = await sb.from('contas_pagar').select('synced_at').eq('loja_id', lojaId).order('synced_at', { ascending: false }).limit(1).maybeSingle()
  const syncAt = syncAtRes.data?.synced_at
    ? new Date(syncAtRes.data.synced_at).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        icon={Wallet}
        description={syncAt ? `Ultima sincronizacao: ${syncAt}` : 'Dados do Omie.'}
      />

      {/* Cards resumo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MoneyCard label="A pagar (total)" value={totalCP} icon={TrendingDown} cor="var(--text-muted)" />
        <MoneyCard label="Atrasado (pagar)" value={totalAtrasado} icon={AlertTriangle} cor="var(--danger)" />
        <MoneyCard label="Vence hoje" value={totalHoje} icon={Clock} cor="var(--warn)" />
        <MoneyCard label="A receber" value={totalCR} icon={TrendingUp} cor="var(--ok)" />
      </div>

      {crAtrasado.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          <span>Recebimento atrasado: <strong><Money value={totalCRAtrasado} /></strong> em {crAtrasado.length} titulos</span>
        </div>
      )}

      {/* Lista de contas a pagar */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-text">Contas a pagar ({cp.length})</h2>
        {cp.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nenhuma conta em aberto" hint="Todas as contas estao pagas." />
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
                {cp.map((item) => {
                  const dias = diasAte(item.data_vencimento)
                  const overdue = (dias ?? 0) < 0
                  const cor = STATUS_COR[item.status_titulo] ?? STATUS_COR.EMABERTO
                  return (
                    <tr key={item.codigo_lancamento_omie} className="hover:bg-surface-2/50">
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-text">{item.numero_documento || '-'}</span>
                        {item.numero_parcela && (
                          <span className="ml-1.5 text-[11px] text-text-muted">{item.numero_parcela}</span>
                        )}
                        {item.codigo_tipo_documento && (
                          <span className="ml-1.5 text-[11px] text-text-muted">{item.codigo_tipo_documento}</span>
                        )}
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
      </section>
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
