import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { carregarDashboardProducao, type Granularidade } from '@/lib/dashboard-producao'
import { ProducaoChart } from '@/components/producao/ProducaoChart'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { buscarFamilias } from '@/lib/actions/produto'
import { BarChart3 } from 'lucide-react'

export const dynamic = 'force-dynamic'

const GRANULARIDADES: { value: Granularidade; label: string }[] = [
  { value: 'dia', label: 'Diária' },
  { value: 'semana', label: 'Semanal' },
  { value: 'mes', label: 'Mensal' },
]

type LinhaPrevProd = {
  n_cod_op: number; num_op: string | null; produto: string | null
  dt_previsao: string | null; dt_conclusao: string | null
  qtde_planejada: number; qtde_produzida: number; divergencia: number; pct: number | null
}

const fmtQtd = (n: number) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtDataBr = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '-')

function mesAtualISO(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

// Achado real (auditoria de filtros/relatorios, Task 5, 2026-08-04): os links de
// granularidade/mes eram montados so com g+mes, descartando tipo/familia/produto/
// local -- ao trocar de Diaria pra Semanal (ou de mes), qualquer filtro ativo
// desaparecia da URL sem o usuario pedir. `filtrosURL` carrega os filtros atuais
// pra dentro de cada link, do mesmo jeito que ChipsPeriodo/ChipsFiltrosAtivos
// preservam os demais params ao navegar.
function linkPara(g: Granularidade, mes: string, filtrosURL: URLSearchParams) {
  const params = new URLSearchParams(filtrosURL)
  params.set('g', g)
  params.set('mes', mes)
  return `/relatorio-producao?${params.toString()}`
}

export default async function RelatorioProducaoPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string; mes?: string; tipo?: string; familia?: string; produto?: string; local?: string }>
}) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()
  const lojaId = await getCurrentLojaId()

  const sp = await searchParams
  const granularidade: Granularidade = ['dia', 'semana', 'mes'].includes(sp.g ?? '') ? (sp.g as Granularidade) : 'dia'
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesAtualISO()

  // Filtros novos: tipo/familia (multi-select), produto (texto), local (select) --
  // unica tela de relatorio que ainda nao tinha nenhuma dessas dimensoes.
  const tiposSel = valoresMulti(sp.tipo)
  const familiasSel = valoresMulti(sp.familia)
  const produtoTexto = sp.produto?.trim() || undefined
  const localCod = sp.local && !Number.isNaN(Number(sp.local)) ? Number(sp.local) : null
  const filtrosURL = new URLSearchParams()
  if (sp.tipo) filtrosURL.set('tipo', sp.tipo)
  if (sp.familia) filtrosURL.set('familia', sp.familia)
  if (sp.produto) filtrosURL.set('produto', sp.produto)
  if (sp.local) filtrosURL.set('local', sp.local)

  const supabase = createServiceClient()
  const [{ buckets, funcionariosOrdenados }, familias, locaisRes] = await Promise.all([
    carregarDashboardProducao(lojaId, granularidade, mes, {
      tipos: tiposSel,
      familias: familiasSel,
      produto: produtoTexto,
      local: localCod,
    }),
    buscarFamilias(),
    supabase
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .order('descricao'),
  ])
  // Hardening (Task 10, auditoria 2026-08-09): .error nunca era checado nas 2
  // queries abaixo (mesmo padrão já corrigido em resumo/page.tsx e lib/resumo-dia.ts,
  // documentado no AGENTS.md -- já causou 3+ incidentes de dado zerado em silêncio).
  // Só loga; não muda o comportamento em caso de sucesso.
  if (locaisRes.error) console.error('relatorio-producao: falha ao carregar local_estoques', locaisRes.error)
  const { data: locaisRaw } = locaisRes

  const campos: CampoFiltro[] = [
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo de mercadoria', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f.descricao, label: f.descricao })) },
    {
      tipo: 'select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
  ]

  // Previsto x produzido (migration 103). A Omie nao guarda as duas
  // quantidades -- ao concluir, nQtde vira o produzido e o planejado se perde.
  // O cron snapshot-op-planejada captura o planejado enquanto a OP esta aberta,
  // entao isso so tem dado a partir do primeiro dia em que ele rodou, e so pras
  // OPs que ainda estavam abertas naquele momento.
  const [divRes, capturaRes] = await Promise.all([
    supabase.rpc('relatorio_op_previsto_produzido', {
      p_loja_id: lojaId, p_ini: `${mes}-01`, p_fim: `${mes}-31`,
    }),
    supabase
      .from('op_qtde_planejada')
      .select('primeira_vez_em')
      .eq('loja_id', lojaId)
      .order('primeira_vez_em', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])
  // Mesmo hardening acima: sem isto, uma RPC quebrada (ex.: migration 103 não
  // aplicada em produção -- já aconteceu com outras 6 migrations nesta mesma
  // auditoria, ver AGENTS.md) faria a seção "Previsto × produzido" mostrar
  // silenciosamente "nenhuma diferença" -- indistinguível de "verificado, sem
  // divergência real".
  if (divRes.error) console.error('relatorio-producao: falha ao carregar relatorio_op_previsto_produzido', divRes.error)
  if (capturaRes.error) console.error('relatorio-producao: falha ao carregar op_qtde_planejada', capturaRes.error)
  const { data: divRaw } = divRes
  const { data: capturaRow } = capturaRes
  const divergencias = (divRaw ?? []) as LinhaPrevProd[]
  const capturaDesde = (capturaRow?.primeira_vez_em as string | undefined) ?? null

  const total = buckets.reduce((s, b) => s + b.total, 0)
  const bucketsComProducao = buckets.filter((b) => b.total > 0)
  const media = bucketsComProducao.length ? Math.round((total / bucketsComProducao.length) * 10) / 10 : 0
  const melhor = buckets.reduce((m, b) => (b.total > m.total ? b : m), buckets[0] ?? { rotulo: '-', total: 0 })

  const [ano, mesNum] = mes.split('-').map(Number)
  const mesAnterior = new Date(ano, mesNum - 2, 1)
  const mesSeguinte = new Date(ano, mesNum, 1)
  const mesAnteriorISO = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`
  const mesSeguinteISO = `${mesSeguinte.getFullYear()}-${String(mesSeguinte.getMonth() + 1).padStart(2, '0')}`
  const ehMesAtual = mes === mesAtualISO()

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Dashboard de Produção"
          icon={BarChart3}
          description="OPs concluídas por período, com quebra por quem concluiu."
          voltarHref="/relatorios"
          actions={
            <FiltrosGaveta
              basePath="/relatorio-producao"
              campos={campos}
              defaults={{
                produto: sp.produto ?? '',
                tipo: sp.tipo ?? '',
                familia: sp.familia ?? '',
                local: sp.local ?? '',
              }}
              persistirEm="/relatorio-producao"
            />
          }
        />
        <ChipsFiltrosAtivos basePath="/relatorio-producao" campos={campos} persistirEm="/relatorio-producao" />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {GRANULARIDADES.map((g) => (
            <Link
              key={g.value}
              href={linkPara(g.value, mes, filtrosURL)}
              aria-current={granularidade === g.value ? 'true' : undefined}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium u-motion ${
                granularidade === g.value
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'
              }`}
            >
              {g.label}
            </Link>
          ))}
        </div>
        {granularidade !== 'mes' && (
          <div className="flex items-center gap-2 text-[13px]">
            <Link href={linkPara(granularidade, mesAnteriorISO, filtrosURL)} className="rounded-md border border-border px-2 py-1 hover:bg-surface-2">
              ← Mês anterior
            </Link>
            <span className="font-medium text-text">{mes}</span>
            {!ehMesAtual && (
              <Link href={linkPara(granularidade, mesSeguinteISO, filtrosURL)} className="rounded-md border border-border px-2 py-1 hover:bg-surface-2">
                Mês seguinte →
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Total no período</p>
          <p className="num mt-0.5 text-xl font-semibold text-text">{total}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Média nos dias com produção</p>
          <p className="num mt-0.5 text-xl font-semibold text-text">{media}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Melhor período</p>
          <p className="num mt-0.5 text-xl font-semibold text-text">
            {melhor.rotulo} ({melhor.total})
          </p>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState icon={BarChart3} title="Sem OPs concluídas no período" hint="Ajuste o período ou aguarde novas conclusões." />
      ) : (
        <ProducaoChart key={`${granularidade}-${mes}`} buckets={buckets} funcionariosOrdenados={funcionariosOrdenados} />
      )}

      {/* Tabela de detalhe -- par acessivel do grafico (skill dataviz: sempre precisa existir) */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[500px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2">
              <th className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Período
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Total
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Por funcionário</th>
            </tr>
          </thead>
          <tbody>
            {bucketsComProducao.map((b) => (
              <tr key={b.chave} className="border-t border-border/60">
                <td className="whitespace-nowrap px-3 py-2 text-text">{b.rotulo}</td>
                <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{b.total}</td>
                <td className="px-3 py-2 text-[12px] text-text-muted">
                  {b.porFuncionario.map((f) => `${f.nome}: ${f.qtd}`).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Previsto x produzido (migration 103) -- RPC propria (relatorio_op_previsto_produzido),
          nao aceita tipo/familia/produto/local: os filtros da gaveta acima nao afetam esta secao. */}
      <div className="space-y-2 pt-2">
        <h2 className="px-1 text-[13px] font-semibold text-text">Previsto × produzido</h2>
        <p className="px-1 text-[11px] text-text-muted">Esta seção sempre mostra todas as OPs do mês, sem os filtros de tipo/família/produto/local acima.</p>
        {divergencias.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-2">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">OP</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Produto</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Conclusão</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">Previsto</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">Produzido</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {divergencias.map((d) => {
                    const aMais = Number(d.divergencia) > 0
                    return (
                      <tr key={d.n_cod_op} className="border-t border-border/60 hover:bg-surface-2/40">
                        <td className="num whitespace-nowrap px-3 py-2 text-text-muted">{d.num_op ?? d.n_cod_op}</td>
                        <td className="max-w-[260px] truncate px-3 py-2 text-text" title={d.produto ?? ''}>{d.produto ?? '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-text-muted">{fmtDataBr(d.dt_conclusao)}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtQtd(d.qtde_planejada)}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{fmtQtd(d.qtde_produzida)}</td>
                        <td className={`num whitespace-nowrap px-3 py-2 text-right font-semibold ${aMais ? 'text-ok' : 'text-warn'}`}>
                          {aMais ? '+' : ''}{fmtQtd(d.divergencia)}
                          {d.pct != null && <span className="ml-1 font-normal text-text-muted">({aMais ? '+' : ''}{Number(d.pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-1 text-[11px] text-text-muted">
              Só aparecem OPs em que o produzido ficou diferente do previsto. O previsto é capturado enquanto a OP está
              aberta — a Omie não guarda as duas quantidades (ao concluir, ela sobrescreve o previsto com o produzido).
            </p>
          </>
        ) : (
          <div className="rounded-lg border border-border bg-surface p-3.5">
            <p className="text-[13px] text-text-muted">
              {capturaDesde ? (
                <>
                  Nenhuma diferença entre previsto e produzido nas OPs concluídas neste mês. A captura do previsto começou
                  em <strong className="text-text">{fmtDataBr(capturaDesde)}</strong> — OPs concluídas antes disso não
                  entram na comparação (a Omie não guarda o previsto depois de concluir).
                </>
              ) : (
                <>Comparação previsto × produzido ainda não disponível — a captura do previsto começa na próxima execução diária.</>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
