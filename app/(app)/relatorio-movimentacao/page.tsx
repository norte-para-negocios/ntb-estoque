import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { ArrowDownUp } from 'lucide-react'

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (ym: string) => {
  const [a, m] = ym.split('-')
  return `${MESES_ABREV[Number(m) - 1] ?? m}/${a.slice(2)}`
}
const fmtData = (d: string) => {
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}
// Quantidade exata (Omie não arredonda), mas enxuta para a célula.
const fmtQtd = (n: number) => (n ? n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '-')

const LIMITE_LINHAS = 200
type LinhaMatriz = { rotulo: string; mes: string; qtde: number; valor: number }

export default async function RelatorioMovimentacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ data_inicio?: string; data_final?: string; sentido?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const sp = await searchParams
  const sentido = sp.sentido === 'entradas' ? 'entradas' : 'saidas'
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO

  const supabase = await createClient()
  async function rpcTodos<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const PAGE = 1000
    const todos: T[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase.rpc(fn, args).range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      todos.push(...(data as T[]))
      if (data.length < PAGE) break
    }
    return todos
  }

  // Dimensão fixa em PRODUTO: somar quantidade por tipo/família não faz sentido
  // (unidades diferentes: KG + UN + L). Por produto, cada linha tem unidade única.
  const matriz = await rpcTodos<LinhaMatriz>('relatorio_movimentacao_matriz', {
    p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_dim: 'produto', p_sentido: sentido,
  })

  const meses = [...new Set(matriz.map((m) => m.mes))].sort()
  const porRotulo = new Map<string, { total: number; meses: Record<string, number> }>()
  for (const r of matriz) {
    const ent = porRotulo.get(r.rotulo) ?? { total: 0, meses: {} }
    const q = Number(r.qtde) || 0
    ent.meses[r.mes] = (ent.meses[r.mes] ?? 0) + q
    ent.total += q
    porRotulo.set(r.rotulo, ent)
  }
  const ordenadas = [...porRotulo.entries()].sort((a, b) => b[1].total - a[1].total)
  const linhas = ordenadas.slice(0, LIMITE_LINHAS).map(([rotulo, ent]) => ({ rotulo: formatarNomeProduto(rotulo) || rotulo, meses: ent.meses, total: ent.total }))
  const ocultadas = ordenadas.length - linhas.length
  const totalPorMes: Record<string, number> = {}
  for (const [, ent] of porRotulo) for (const m of meses) totalPorMes[m] = (totalPorMes[m] ?? 0) + (ent.meses[m] ?? 0)

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Movimentação"
          icon={ArrowDownUp}
          description="Entradas e saídas por produto, mês a mês (em quantidade) — BETA"
        />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-text-muted">Período: {fmtData(ini)} a {fmtData(fim)}</span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Produtos <span className="num font-semibold text-text">{ordenadas.length}</span>
        </span>
      </div>

      <SegmentLinks
        basePath="/relatorio-movimentacao"
        param="sentido"
        aria-label="Sentido"
        opcoes={[
          { value: '', label: 'Saídas (consumo/venda)' },
          { value: 'entradas', label: 'Entradas' },
        ]}
      />

      {linhas.length === 0 ? (
        <EmptyState icon={ArrowDownUp} title="Sem movimentação no período" hint="Ajuste o período. O histórico cobre cerca de 1 ano." />
      ) : (
        <div className="space-y-1.5">
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>Produto</th>
                  {meses.map((m) => (<th key={m} className={`text-right ${th}`}>{mesLabel(m)}</th>))}
                  <th className={`text-right ${th}`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.rotulo} className="border-t border-border/60 hover:bg-surface-2/40">
                    <td className="sticky left-0 z-10 max-w-[240px] truncate bg-surface px-3 py-2 text-text" title={l.rotulo}>{l.rotulo}</td>
                    {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtQtd(l.meses[m] ?? 0)}</td>))}
                    <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{fmtQtd(l.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-2/70 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-text">Total (qtde)</td>
                  {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtQtd(totalPorMes[m] ?? 0)}</td>))}
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtQtd(Object.values(totalPorMes).reduce((s, v) => s + v, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="px-1 text-[11px] text-text-muted">
            Em quantidade (a soma por mês mistura unidades; vale como volume total). Valor em R$ depende do import do Omie.
            {ocultadas > 0 && ` Mostrando os ${LIMITE_LINHAS} maiores de ${ordenadas.length}.`}
          </p>
        </div>
      )}
    </div>
  )
}
