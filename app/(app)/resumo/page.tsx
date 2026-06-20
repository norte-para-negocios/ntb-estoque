import { notFound } from 'next/navigation'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { carregarResumoDia, hojeBahia } from '@/lib/resumo-dia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ResumoFiltros } from '@/components/resumo/ResumoFiltros'
import { LayoutDashboard, Download, Inbox } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

export const dynamic = 'force-dynamic'

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
}

function fmtDataBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Card de numero (KPI do dia).
function Kpi({ label, valor, sub }: { label: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="eyebrow">{label}</div>
      <div className="num mt-1 text-2xl font-semibold tracking-tight text-text">{valor}</div>
      {sub && <div className="mt-0.5 text-[12px] text-text-muted">{sub}</div>}
    </div>
  )
}

export default async function ResumoPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; loja?: string }>
}) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const sp = await searchParams
  const hoje = hojeBahia()
  const data = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) && sp.data <= hoje ? sp.data : hoje

  // Lojas do escopo (para o seletor e os rotulos).
  const supabase = createServiceClient()
  const { data: lojasRaw } = await supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .in('id', ator.lojaIds.length ? ator.lojaIds : [-1])
    .order('nome_fantasia')
  const lojas = (lojasRaw ?? []).map((l) => ({ id: l.id as number, nome: (l.nome_fantasia || l.nome || `Loja ${l.id}`) as string }))

  // Por padrão escopa para a LOJA ATUAL (a do seletor da barra lateral), igual ao
  // resto do sistema. O admin pode escolher "Todas as lojas" explicitamente
  // (?loja=todas). Admin de loja só enxerga as lojas dele (ator.lojaIds).
  const lojaAtual = await getCurrentLojaId()
  let lojaSel: number | null
  if (sp.loja === 'todas') {
    lojaSel = null
  } else if (sp.loja && ator.lojaIds.includes(Number(sp.loja))) {
    lojaSel = Number(sp.loja)
  } else {
    lojaSel = ator.lojaIds.includes(lojaAtual) ? lojaAtual : (ator.lojaIds[0] ?? null)
  }
  const lojaIdsEfetivos = lojaSel ? [lojaSel] : ator.lojaIds

  const { kpis, feed, porLoja } = await carregarResumoDia(lojaIdsEfetivos, data)

  const pdfParams = new URLSearchParams({ data })
  if (lojaSel != null) pdfParams.set('loja', String(lojaSel))

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Resumo do dia"
          icon={LayoutDashboard}
          description="O que foi feito no dia: números e atividade da equipe"
          actions={
            <a
              href={`/resumo/imprimir?${pdfParams.toString()}`}
              target="_blank"
              rel="noopener noreferrer"
              className={btnClass('outline')}
            >
              <Download className="size-4" /> PDF do dia
            </a>
          }
        />
        <ResumoFiltros data={data} lojaSel={lojaSel} lojas={lojas} hoje={hoje} />
      </ListaHeader>

      {/* NUMEROS DO DIA */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Transferências" valor={fmt(kpis.transferencias)} />
        <Kpi label="Inventários" valor={fmt(kpis.inventarios)} />
        <Kpi label="Ordens de Produção" valor={fmt(kpis.opsCriadas)} sub={`${fmt(kpis.opsConcluidas)} concluída(s)`} />
        <Kpi label="Movimentações" valor={fmt(kpis.movEntradas + kpis.movSaidas)} sub={`${fmt(kpis.movEntradas)} entram · ${fmt(kpis.movSaidas)} saem`} />
        <Kpi label="Etiquetas" valor={fmt(kpis.etiquetas)} />
        <Kpi label="Erros de integração" valor={fmt(kpis.erros)} />
      </div>

      {/* POR LOJA (so quando ha mais de uma) */}
      {porLoja.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="eyebrow mb-2">Atividade por loja</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {porLoja.map((l) => (
              <span key={l.lojaId} className="text-[13px] text-text">
                {l.nome} <span className="num font-semibold text-brand">{fmt(l.total)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* FEED: quem fez o que */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-text">Atividade de {fmtDataBR(data)}</span>
          <span className="ml-2 text-[12px] text-text-muted">{feed.length} ação(ões)</span>
        </div>
        {feed.length === 0 ? (
          <EmptyState icon={Inbox} title="Nada registrado nesse dia" hint="Escolha outra data ou aguarde a equipe operar." />
        ) : (
          <ul className="divide-y divide-border/60">
            {feed.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
                <span className="num w-12 shrink-0 text-[12px] text-text-muted">{e.hora || '·'}</span>
                <span className="text-sm text-text">
                  <span className="font-medium">{e.pessoa ?? 'Sistema'}</span> {e.acao}{' '}
                  <span className="text-text-muted">{e.alvo}</span>
                </span>
                {e.status && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
                    {e.status}
                  </span>
                )}
                {e.lojaNome && <span className="text-[11px] text-text-muted">· {e.lojaNome}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
