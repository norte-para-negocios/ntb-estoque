import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { ImportarFaturamento } from '@/components/faturamento/ImportarFaturamento'
import { btnClass } from '@/components/ui-kit/Button'
import { DollarSign, Download } from 'lucide-react'

const DIMS = [
  { value: 'tipo', label: 'Tipo' },
  { value: 'familia', label: 'Família' },
  { value: 'forma_pgto', label: 'Forma de pgto' },
] as const

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (ym: string) => {
  const [a, m] = ym.split('-')
  return `${MESES_ABREV[Number(m) - 1] ?? m}/${a.slice(2)}`
}
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtCel = (n: number) => (n ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-')
const fmtQuando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })

type LinhaMatriz = { rotulo: string; mes: string; valor: number }

export default async function RelatorioFaturamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ dim?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const sp = await searchParams
  const dim = DIMS.some((d) => d.value === sp.dim) ? sp.dim! : 'tipo'

  const supabase = createServiceClient()
  const [{ data: matrizRaw }, { data: metaRow }] = await Promise.all([
    supabase.rpc('relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: dim }),
    supabase.from('faturamento_import_meta').select('importado_em, arquivo').eq('loja_id', lojaId).maybeSingle(),
  ])
  const matriz = (matrizRaw ?? []) as LinhaMatriz[]

  const meses = [...new Set(matriz.map((m) => m.mes))].sort()
  const porRotulo = new Map<string, { total: number; meses: Record<string, number> }>()
  let totalGeral = 0
  for (const r of matriz) {
    const ent = porRotulo.get(r.rotulo) ?? { total: 0, meses: {} }
    const v = Number(r.valor) || 0
    ent.meses[r.mes] = (ent.meses[r.mes] ?? 0) + v
    ent.total += v
    totalGeral += v
    porRotulo.set(r.rotulo, ent)
  }
  const linhas = [...porRotulo.entries()].sort((a, b) => b[1].total - a[1].total).map(([rotulo, ent]) => ({ rotulo, meses: ent.meses, total: ent.total }))
  const totalPorMes: Record<string, number> = {}
  for (const [, ent] of porRotulo) for (const m of meses) totalPorMes[m] = (totalPorMes[m] ?? 0) + (ent.meses[m] ?? 0)

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Faturamento"
          icon={DollarSign}
          description="Vendas do PDV, importado do Omie (BETA)"
          actions={
            <>
              {matriz.length > 0 && (
                <a href="/relatorio-faturamento/export" target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: matriz mês a mês por tipo, família e forma de pgto (com filtros)">
                  <Download className="size-4" /> Baixar
                </a>
              )}
              <ImportarFaturamento />
            </>
          }
        />
      </ListaHeader>

      {!matriz.length ? (
        <EmptyState
          icon={DollarSign}
          title="Sem faturamento importado"
          hint='As vendas do PDV (NFC-e) não vêm pela API do Omie. Exporte o "FAT_DRV" no Omie, remova a aba "BD" (dados brutos), e clique em "Importar do Omie".'
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
              Total faturado <span className="num font-semibold text-text"><Money value={totalGeral} /></span>
            </span>
            {metaRow?.importado_em && (
              <span className="text-[13px] text-text-muted">Importado em {fmtQuando(metaRow.importado_em as string)}</span>
            )}
          </div>

          <SegmentLinks
            basePath="/relatorio-faturamento"
            param="dim"
            aria-label="Abrir faturamento por"
            opcoes={DIMS.map((d) => ({ value: d.value === 'tipo' ? '' : d.value, label: d.label }))}
          />

          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>{DIMS.find((d) => d.value === dim)?.label}</th>
                  {meses.map((m) => (<th key={m} className={`text-right ${th}`}>{mesLabel(m)}</th>))}
                  <th className={`text-right ${th}`}>Total</th>
                  <th className={`text-right ${th}`}>%</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.rotulo} className="border-t border-border/60 hover:bg-surface-2/40">
                    <td className="sticky left-0 z-10 max-w-[240px] truncate bg-surface px-3 py-2 text-text" title={l.rotulo}>{l.rotulo}</td>
                    {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtCel(l.meses[m] ?? 0)}</td>))}
                    <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{fmtMoeda(l.total)}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{totalGeral > 0 ? `${((l.total / totalGeral) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-2/70 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-text">Total</td>
                  {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtCel(totalPorMes[m] ?? 0)}</td>))}
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtMoeda(totalGeral)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
