import { createClient } from '@/lib/supabase/server'
import { isSuperAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { StatCard } from '@/components/ui-kit/StatCard'
import { Num } from '@/components/ui-kit/Num'
import { Database, HardDrive, TrendingUp, AlertTriangle } from 'lucide-react'

const LIMITE_FREE_MB = 500
const LIMITE_ALERTA_MB = 400

type TabelaSaude = { nome: string; mb: number; linhas: number }
type SaudeBanco = {
  total_mb: number
  tabelas: TabelaSaude[]
  novas_linhas_7d: Record<string, number>
}

export default async function SaudeBancoPage() {
  const superAdmin = await isSuperAdmin()
  if (!superAdmin) notFound()

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('saude_banco')
  if (error || !data) notFound()

  const saude = data as SaudeBanco
  const pct = Math.min(100, (saude.total_mb / LIMITE_FREE_MB) * 100)
  const tom: 'ok' | 'warn' | 'err' =
    saude.total_mb >= LIMITE_ALERTA_MB + 60 ? 'err' : saude.total_mb >= LIMITE_ALERTA_MB ? 'warn' : 'ok'
  const tomTexto = tom === 'ok' ? 'text-ok' : tom === 'warn' ? 'text-warn' : 'text-err'
  const tomBarra = tom === 'ok' ? 'bg-ok' : tom === 'warn' ? 'bg-warn' : 'bg-err'

  // Projecao: bytes/linha das tabelas monitoradas, aplicado as linhas novas dos ultimos 7 dias.
  const tabelasPorNome = new Map(saude.tabelas.map((t) => [t.nome, t]))
  let crescimentoMb7d = 0
  for (const [nome, linhas] of Object.entries(saude.novas_linhas_7d)) {
    const t = tabelasPorNome.get(nome)
    if (!t || !t.linhas) continue
    const bytesPorLinha = (t.mb * 1024 * 1024) / t.linhas
    crescimentoMb7d += (linhas * bytesPorLinha) / 1024 / 1024
  }
  const crescimentoMbDia = crescimentoMb7d / 7
  const diasAte500 =
    crescimentoMbDia > 0.1 ? Math.max(0, (LIMITE_FREE_MB - saude.total_mb) / crescimentoMbDia) : null

  const maiorTabela = saude.tabelas[0]

  return (
    <div>
      <PageHeader
        title="Saúde do Banco"
        icon={Database}
        description="Monitoramento do Postgres (Supabase free tier, limite 500 MB)"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tamanho total (MB)" value={saude.total_mb} icon={HardDrive} accent="var(--brand)" />
        <StatCard
          label="Maior tabela (MB)"
          value={maiorTabela?.mb ?? 0}
          hint={maiorTabela?.nome}
          icon={Database}
        />
        <StatCard
          label="Crescimento 7d (MB)"
          value={Math.round(crescimentoMb7d * 10) / 10}
          hint="inclui backfills ativos"
          icon={TrendingUp}
          accent="var(--warn)"
        />
        <StatCard
          label="Dias até 500 MB"
          value={diasAte500 != null ? Math.round(diasAte500) : 0}
          hint={diasAte500 != null ? 'no ritmo atual' : 'sem crescimento relevante'}
          icon={AlertTriangle}
          accent={tom === 'ok' ? 'var(--ok)' : tom === 'warn' ? 'var(--warn)' : 'var(--err)'}
        />
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between text-[13px]">
          <span className="font-medium text-text">
            <Num value={saude.total_mb} frac={1} /> MB de {LIMITE_FREE_MB} MB
          </span>
          <span className={`font-semibold ${tomTexto}`}>{pct.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div className={`h-full rounded-full transition-all ${tomBarra}`} style={{ width: `${pct}%` }} />
        </div>
        {saude.total_mb >= LIMITE_ALERTA_MB && (
          <p className={`mt-2 text-[12px] ${tomTexto}`}>
            Acima de {LIMITE_ALERTA_MB} MB — acompanhar de perto.
          </p>
        )}
      </div>

      <div className="mt-4 overflow-clip rounded-lg border border-border bg-surface">
        <div className="border-b border-border bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Maiores tabelas
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-text-muted">
              <th className="px-4 py-2 font-medium">Tabela</th>
              <th className="px-4 py-2 text-right font-medium">Tamanho</th>
              <th className="px-4 py-2 text-right font-medium">Linhas</th>
            </tr>
          </thead>
          <tbody>
            {saude.tabelas.map((t) => (
              <tr key={t.nome} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-text">{t.nome}</td>
                <td className="px-4 py-2 text-right text-text">
                  <Num value={t.mb} frac={1} /> MB
                </td>
                <td className="px-4 py-2 text-right text-text-muted">
                  <Num value={t.linhas} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[12px] text-text-muted">
        Projeção calculada a partir das linhas novas dos últimos 7 dias em movimentos, ordens_producao e
        nota_fiscal_items. Durante um backfill ativo (ex.: histórico de ajustes Omie) esse número fica bem
        acima do ritmo normal do dia a dia — não trate como previsão definitiva enquanto um backfill estiver
        rodando.
      </p>
    </div>
  )
}
