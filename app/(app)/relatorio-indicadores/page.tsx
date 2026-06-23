import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { Scale, Download } from 'lucide-react'

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (ym: string) => {
  const [a, m] = ym.split('-')
  return `${MESES_ABREV[Number(m) - 1] ?? m}/${a.slice(2)}`
}
const fmtCel = (n: number) => (n ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-')
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (n: number) => (Number.isFinite(n) ? `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-')
const fmtQuando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })

type LinhaMatriz = { rotulo: string; mes: string; valor: number }

// Meta do Ramon: Compras ÷ Faturamento ideal abaixo de 40% (na indústria), alguns
// miram 35%. Quanto menos, melhor. Cor por faixa: <=40% no alvo, <=50% atenção, acima vermelho.
const META_PCT = 40
const corMeta = (pct: number) => (!Number.isFinite(pct) ? 'text-text-muted' : pct <= META_PCT ? 'text-ok' : pct <= 50 ? 'text-warn' : 'text-err')

export default async function RelatorioIndicadoresPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const supabase = createServiceClient()

  // Faturamento importado (vendas) por mês.
  const { data: fatRaw } = await supabase.rpc('relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: 'tipo' })
  const fat = (fatRaw ?? []) as LinhaMatriz[]

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  if (!fat.length) {
    return (
      <div className="space-y-4">
        <ListaHeader>
          <PageHeader title="Fat × Compras" icon={Scale} description="Quanto você comprou para cada real vendido (BETA)" />
        </ListaHeader>
        <EmptyState
          icon={Scale}
          title="Importe o faturamento primeiro"
          hint='Os indicadores cruzam o que você VENDEU (Faturamento) com o que COMPROU (NF de entrada). Importe o faturamento e os números aparecem aqui.'
        />
        <div className="text-center">
          <Link href="/relatorio-faturamento" className="text-[13px] text-brand hover:underline">
            Ir para Faturamento
          </Link>
        </div>
      </div>
    )
  }

  const fatPorMes: Record<string, number> = {}
  for (const r of fat) fatPorMes[r.mes] = (fatPorMes[r.mes] ?? 0) + (Number(r.valor) || 0)
  const fatMeses = Object.keys(fatPorMes).sort()

  // Compras (NF de entrada) no mesmo intervalo de anos do faturamento.
  const anoIni = fatMeses[0].slice(0, 4)
  const anoFim = fatMeses[fatMeses.length - 1].slice(0, 4)
  const { data: compRaw } = await supabase.rpc('relatorio_compras_matriz', {
    p_loja_id: lojaId, p_ini: `${anoIni}-01-01`, p_fim: `${anoFim}-12-31`, p_dim: 'tipo',
  })
  const comp = (compRaw ?? []) as LinhaMatriz[]
  const comprasPorMes: Record<string, number> = {}
  for (const r of comp) comprasPorMes[r.mes] = (comprasPorMes[r.mes] ?? 0) + (Number(r.valor) || 0)

  const { data: metaRow } = await supabase
    .from('faturamento_import_meta').select('importado_em').eq('loja_id', lojaId).maybeSingle()

  // Une os meses das duas fontes (compras pode ter meses que o faturamento ainda não).
  const meses = [...new Set([...Object.keys(fatPorMes), ...Object.keys(comprasPorMes)])].sort()

  const totFat = meses.reduce((s, m) => s + (fatPorMes[m] ?? 0), 0)
  const totComp = meses.reduce((s, m) => s + (comprasPorMes[m] ?? 0), 0)
  const totRes = totFat - totComp
  const pctTotal = totFat > 0 ? (totComp / totFat) * 100 : NaN

  // Linhas-indicador (linha = indicador, coluna = mês), estilo IND_PER do Ramon.
  const fmtCelOrPct = (v: number, tipo: 'money' | 'pct') => (tipo === 'pct' ? fmtPct(v) : fmtCel(v))
  const indicadores: {
    nome: string
    tipo: 'money' | 'res' | 'pct'
    porMes: (m: string) => number
    total: number
    destaque?: boolean
  }[] = [
    { nome: 'Faturamento (vendas)', tipo: 'money', porMes: (m) => fatPorMes[m] ?? 0, total: totFat },
    { nome: 'Compras (NF de entrada)', tipo: 'money', porMes: (m) => comprasPorMes[m] ?? 0, total: totComp },
    { nome: 'Faturamento − Compras', tipo: 'res', porMes: (m) => (fatPorMes[m] ?? 0) - (comprasPorMes[m] ?? 0), total: totRes },
    {
      nome: 'Compras ÷ Faturamento',
      tipo: 'pct',
      porMes: (m) => (fatPorMes[m] ? ((comprasPorMes[m] ?? 0) / fatPorMes[m]) * 100 : NaN),
      total: pctTotal,
      destaque: true,
    },
  ]

  const corRes = (v: number) => (v >= 0 ? 'text-ok' : 'text-err')

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Fat × Compras"
          icon={Scale}
          description="Quanto você comprou para cada real vendido (BETA)"
          actions={
            <a href="/relatorio-indicadores/export" target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: Faturamento, Compras, Resultado e % mês a mês">
              <Download className="size-4" /> Baixar
            </a>
          }
        />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Faturado <span className="num font-semibold text-text"><Money value={totFat} /></span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Comprado <span className="num font-semibold text-text"><Money value={totComp} /></span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Compras ÷ Fat <span className={`num font-semibold ${corMeta(pctTotal)}`}>{fmtPct(pctTotal)}</span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Meta <span className="num font-semibold text-text">≤ {META_PCT}%</span>
          {Number.isFinite(pctTotal) && (
            <span className={`ml-1 font-semibold ${corMeta(pctTotal)}`}>
              {pctTotal <= META_PCT ? '· no alvo' : `· ${(pctTotal - META_PCT).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p. acima`}
            </span>
          )}
        </span>
        {metaRow?.importado_em && (
          <span className="text-[13px] text-text-muted">Faturamento importado em {fmtQuando(metaRow.importado_em as string)}</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2">
              <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>Indicador</th>
              {meses.map((m) => (<th key={m} className={`text-right ${th}`}>{mesLabel(m)}</th>))}
              <th className={`text-right ${th}`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {indicadores.map((ind) => (
              <tr
                key={ind.nome}
                className={`border-t border-border/60 ${ind.destaque ? 'bg-surface-2/50 font-semibold' : 'hover:bg-surface-2/40'}`}
              >
                <td className="sticky left-0 z-10 max-w-[240px] truncate bg-surface px-3 py-2 text-text" title={ind.nome}>{ind.nome}</td>
                {meses.map((m) => {
                  const v = ind.porMes(m)
                  const cls = ind.tipo === 'res' ? corRes(v) : ind.tipo === 'pct' ? corMeta(v) : ind.destaque ? 'text-text' : 'text-text-muted'
                  return (
                    <td key={m} className={`num whitespace-nowrap px-3 py-2 text-right ${cls}`}>
                      {ind.tipo === 'pct' ? fmtPct(v) : fmtCelOrPct(v, 'money')}
                    </td>
                  )
                })}
                <td className={`num whitespace-nowrap px-3 py-2 text-right font-medium ${ind.tipo === 'res' ? corRes(ind.total) : ind.tipo === 'pct' ? corMeta(ind.total) : 'text-text'}`}>
                  {ind.tipo === 'pct' ? fmtPct(ind.total) : fmtMoeda(ind.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-[11px] text-text-muted">
        Faturamento vem do import do FAT do Omie; Compras vem das NFs de entrada (valor do item). &quot;Compras ÷ Faturamento&quot; é
        quanto você gastou comprando para cada real vendido. Meta: <span className="font-medium text-ok">≤ {META_PCT}%</span> no alvo,
        <span className="font-medium text-warn"> até 50% atenção</span>, <span className="font-medium text-err">acima de 50% alto</span> (na indústria, alguns miram 35%).
        &quot;Faturamento − Compras&quot; não é lucro: Compras é a entrada de mercadoria do mês, não o custo do que foi consumido (margem real vem do Módulo de Margem).
      </p>
    </div>
  )
}
