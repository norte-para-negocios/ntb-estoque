import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { type CampoFiltro, valoresMulti } from '@/components/ui-kit/filtros-utils'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { ImportarFaturamento } from '@/components/faturamento/ImportarFaturamento'
import { SyncButton } from '@/components/SyncButton'
import { btnClass } from '@/components/ui-kit/Button'
import Link from 'next/link'
import { DollarSign, Download } from 'lucide-react'

const DIMS = [
  { value: 'tipo', label: 'Tipo' },
  { value: 'familia', label: 'Família' },
  { value: 'forma_pgto', label: 'Forma de pgto' },
] as const

const CHIPS_PERIODO = [
  { value: '', label: 'Todos' },
  { value: '1', label: 'Este mês' },
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
] as const

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (ym: string) => {
  const [a, m] = ym.split('-')
  return `${MESES_ABREV[Number(m) - 1] ?? m}/${a.slice(2)}`
}
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtCel = (n: number) => (n ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-')
const fmtQuando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })

function mesOffset(refMes: string, n: number): string {
  const [a, m] = refMes.split('-').map(Number)
  let mes = m + n
  let ano = a
  while (mes > 12) { mes -= 12; ano++ }
  while (mes < 1) { mes += 12; ano-- }
  return `${ano}-${String(mes).padStart(2, '0')}`
}

type LinhaMatriz = { rotulo: string; mes: string; valor: number }
type OpcaoDim = { dimensao: string; rotulo: string }

export default async function RelatorioFaturamentoPage({
  searchParams,
}: {
  searchParams: Promise<{
    dim?: string
    periodo?: string
    data_inicio?: string
    data_final?: string
    tipo?: string
    familia?: string
    forma_pgto?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const sp = await searchParams
  const dim = DIMS.some((d) => d.value === sp.dim) ? sp.dim! : 'tipo'
  const periodo = CHIPS_PERIODO.some((c) => c.value === (sp.periodo ?? '')) ? (sp.periodo ?? '') : ''

  // Período customizado (filtro livre, na gaveta) tem prioridade sobre os chips fixos.
  const dataIni = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : ''
  const dataFim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : ''
  const temPeriodoCustom = !!(dataIni || dataFim)

  const mesAtual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 7)
  const mesIniChip = periodo && !temPeriodoCustom ? mesOffset(mesAtual, -(Number(periodo) - 1)) : null
  const mesIni = dataIni ? dataIni.slice(0, 7) : mesIniChip
  const mesFim = dataFim ? dataFim.slice(0, 7) : null

  const dimParam = dim === 'tipo' ? '' : dim
  const chipHref = (p: string) => {
    const parts: string[] = []
    if (dimParam) parts.push(`dim=${dimParam}`)
    if (p) parts.push(`periodo=${p}`)
    return `/relatorio-faturamento${parts.length ? '?' + parts.join('&') : ''}`
  }

  // faturamento_importado já vem pré-agregado em 3 pivots separados (um por
  // dimensão), sem uma linha de fato por cupom -- então não dá pra cruzar
  // "família X" com "tipo Y" ao mesmo tempo. Por isso o filtro de rótulos
  // aplicado na RPC é sempre o da dimensão que está sendo exibida (`dim`); os
  // outros dois ficam guardados na URL e entram em ação quando o usuário troca
  // de aba (SegmentLinks) para a dimensão correspondente.
  const tipoFiltro = valoresMulti(sp.tipo)
  const familiaFiltro = valoresMulti(sp.familia)
  const formaPgtoFiltro = valoresMulti(sp.forma_pgto)
  const rotulosFiltro = dim === 'tipo' ? tipoFiltro : dim === 'familia' ? familiaFiltro : formaPgtoFiltro

  const supabase = createServiceClient()
  const [matriz, { data: metaRow }, { data: opcoesRaw }] = await Promise.all([
    rpcTodos<LinhaMatriz>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId,
      p_dim: dim,
      p_mes_ini: mesIni,
      p_mes_fim: mesFim,
      p_rotulos: rotulosFiltro.length ? rotulosFiltro : null,
    }),
    supabase
      .from('faturamento_import_meta')
      .select('importado_em, arquivo, linhas')
      .eq('loja_id', lojaId)
      .maybeSingle(),
    supabase.rpc('relatorio_faturamento_opcoes', { p_loja_id: lojaId }),
  ])
  // "Tem faturamento importado" não pode depender do resultado já filtrado
  // (senão um filtro sem resultado cairia no empty state errado, de "nunca
  // sincronizou"). `linhas` vem do último import/sync, sem filtro nenhum.
  const temImportacao = (metaRow?.linhas ?? 0) > 0
  const opcoesPorDim = (opcoesRaw ?? []) as OpcaoDim[]
  const opcoesDe = (d: string) =>
    opcoesPorDim.filter((o) => o.dimensao === d).map((o) => ({ value: o.rotulo, label: o.rotulo }))

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
  // Pedido reuniao 09/07: na dimensao "tipo", produto acabado primeiro (o que o
  // Ramon quer ver de cara), depois revenda/materia-prima, "nao classificado"/
  // "outras" por ultimo (rotulo cru do Excel do Omie -- ver comentario na RPC,
  // nao e classificacao nossa). Demais dimensoes continuam so por valor.
  const ORDEM_TIPO_FAT: Record<string, number> = {
    'Produto acabado': 0,
    'Mercadoria p/ revenda': 1,
    'Matéria-prima': 2,
    'Tipo KT': 3,
    'Outras': 4,
    'Não classificado': 5,
  }
  const linhas = [...porRotulo.entries()]
    .sort((a, b) =>
      dim === 'tipo'
        ? (ORDEM_TIPO_FAT[a[0]] ?? 9) - (ORDEM_TIPO_FAT[b[0]] ?? 9) || b[1].total - a[1].total
        : b[1].total - a[1].total
    )
    .map(([rotulo, ent]) => ({ rotulo, meses: ent.meses, total: ent.total }))
  const totalPorMes: Record<string, number> = {}
  for (const [, ent] of porRotulo) for (const m of meses) totalPorMes[m] = (totalPorMes[m] ?? 0) + (ent.meses[m] ?? 0)

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo', opcoes: opcoesDe('tipo') },
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: opcoesDe('familia') },
    { tipo: 'multi-select', nome: 'forma_pgto', label: 'Forma de pagamento', opcoes: opcoesDe('forma_pgto') },
  ]

  const exportParams = new URLSearchParams()
  if (dataIni) exportParams.set('data_inicio', dataIni)
  if (dataFim) exportParams.set('data_final', dataFim)
  if (tipoFiltro.length) exportParams.set('tipo', tipoFiltro.join(','))
  if (familiaFiltro.length) exportParams.set('familia', familiaFiltro.join(','))
  if (formaPgtoFiltro.length) exportParams.set('forma_pgto', formaPgtoFiltro.join(','))
  const exportHref = `/relatorio-faturamento/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'
  const chipBase = 'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors'
  const chipAtivo = `${chipBase} border-ink bg-ink text-white`
  const chipInativo = `${chipBase} border-border bg-surface text-text-muted hover:border-text/30 hover:text-text`

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Faturamento"
          icon={DollarSign}
          description="Vendas do PDV (NFC-e), puxadas direto da API do Omie (BETA)"
          voltarHref="/relatorios"
          actions={
            <>
              {temImportacao && (
                <a href={exportHref} target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: matriz mês a mês por tipo, família e forma de pgto (com filtros)">
                  <Download className="size-4" /> Baixar
                </a>
              )}
              <FiltrosGaveta
                basePath="/relatorio-faturamento"
                campos={campos}
                defaults={{
                  data_inicio: sp.data_inicio ?? '',
                  data_final: sp.data_final ?? '',
                  tipo: sp.tipo ?? '',
                  familia: sp.familia ?? '',
                  forma_pgto: sp.forma_pgto ?? '',
                }}
                persistirEm="/relatorio-faturamento"
              />
              <SyncButton
                endpoint="/api/sync/faturamento"
                label="Atualizar"
                title="Puxa tipo e família direto dos cupons fiscais do Omie. Ainda não roda sozinho: clique aqui sempre que quiser atualizar."
              />
              <ImportarFaturamento />
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/relatorio-faturamento" campos={campos} persistirEm="/relatorio-faturamento" />
      </ListaHeader>

      {!temImportacao ? (
        <EmptyState
          icon={DollarSign}
          title="Faturamento ainda não sincronizado"
          hint='As vendas do PDV desta loja ainda não foram puxadas da API do Omie. Clique em "Atualizar" para sincronizar agora, ou importe o export FAT_DRV.'
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            {CHIPS_PERIODO.map((c) => (
              <Link key={c.value} href={chipHref(c.value)} className={periodo === c.value && !temPeriodoCustom ? chipAtivo : chipInativo}>
                {c.label}
              </Link>
            ))}
          </div>

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

          {!matriz.length ? (
            <EmptyState
              icon={DollarSign}
              title="Sem dados no período"
              hint="Tente ampliar o período ou remover filtros ativos."
            />
          ) : (
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
          )}
        </>
      )}
    </div>
  )
}
