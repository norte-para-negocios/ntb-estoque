import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { type CampoFiltro, valoresMulti } from '@/components/ui-kit/filtros-utils'
import { buscarFamilias } from '@/lib/actions/produto'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio, filtrarItensCompras, agregarComprasMatriz } from '@/lib/relatorio-frio-nf'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { descreverCFOP } from '@/lib/cfop'
import type { LojaOmie } from '@/lib/omie/client'
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
const corMeta = (pct: number, meta: number) => (!Number.isFinite(pct) ? 'text-text-muted' : pct <= meta ? 'text-ok' : pct <= 50 ? 'text-warn' : 'text-err')

export default async function RelatorioIndicadoresPage({
  searchParams,
}: {
  searchParams: Promise<{ data_inicio?: string; data_final?: string; familia?: string; produto?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const supabaseLoja = createServiceClient()
  const { data: lojaRow } = await supabaseLoja
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, meta_compras_pct')
    .eq('id', lojaId)
    .single<LojaOmie & { meta_compras_pct: number | null }>()
  const metaPct = lojaRow?.meta_compras_pct ?? 40

  const sp = await searchParams
  const filtroIni = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : null
  const filtroFim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : null
  const familiasSel = valoresMulti(sp.familia)
  const produtoTermo = sp.produto?.trim() || null
  const filtroAtivo = !!(familiasSel.length || produtoTermo)

  const familiasOpcoes = await buscarFamilias()
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome)' },
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })) },
  ]

  const supabase = createServiceClient()

  // Faturamento importado (vendas) por mês. A RPC não aceita período (removido na
  // migration 057); o filtro de data_inicio/data_final é aplicado aqui no app.
  // Com filtro de produto/família ativo, muda a dimensão consultada pra restringir
  // os DOIS lados da razão ao mesmo recorte (Compras recebe o equivalente abaixo).
  let fat: LinhaMatriz[]
  if (produtoTermo) {
    // dimensao 'produto' e populada pelo sync do faturamento; filtra rotulos por texto.
    const termoLower = produtoTermo.toLowerCase()
    const todos = await rpcTodos<LinhaMatriz>(supabase, 'relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: 'produto' })
    fat = todos.filter((r) => r.rotulo.toLowerCase().includes(termoLower))
  } else if (familiasSel.length) {
    fat = await rpcTodos<LinhaMatriz>(supabase, 'relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: 'familia', p_rotulos: familiasSel })
  } else {
    fat = await rpcTodos<LinhaMatriz>(supabase, 'relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: 'tipo' })
  }

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  if (!fat.length && !filtroAtivo) {
    return (
      <div className="space-y-4">
        <ListaHeader>
          <PageHeader title="Fat × Compras" icon={Scale} description="Quanto você comprou para cada real vendido (BETA)" voltarHref="/relatorios" />
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

  const fatPorMesTudo: Record<string, number> = {}
  for (const r of fat) fatPorMesTudo[r.mes] = (fatPorMesTudo[r.mes] ?? 0) + (Number(r.valor) || 0)
  const todosMeses = Object.keys(fatPorMesTudo).sort()

  // Filtro de período (AAAA-MM-DD) vira corte por mês (AAAA-MM) no faturamento.
  const iniYM = filtroIni ? filtroIni.slice(0, 7) : null
  const fimYM = filtroFim ? filtroFim.slice(0, 7) : null
  const fatPorMes = Object.fromEntries(
    Object.entries(fatPorMesTudo).filter(([m]) => (!iniYM || m >= iniYM) && (!fimYM || m <= fimYM))
  )

  // Compras (NF de entrada): mesmo período do filtro quando informado; senão, o
  // intervalo de anos do faturamento (comportamento padrão de sempre).
  const anoAtual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 4)
  const anoIni = todosMeses.length ? todosMeses[0].slice(0, 4) : anoAtual
  const anoFim = todosMeses.length ? todosMeses[todosMeses.length - 1].slice(0, 4) : anoAtual
  const compIni = filtroIni ?? `${anoIni}-01-01`
  const compFim = filtroFim ?? `${anoFim}-12-31`
  // dim=cfop (em vez de tipo) pra poder excluir Ativo imobilizado da conta: é
  // investimento, não gasto operacional (pedido do Ramon, reunião 06/07).
  // Janela quente cobre ~90 dias; RPC clampa o início, e o pedaço antigo vem
  // do Contabo reagregado em JS (lib/relatorio-frio-nf.ts) — sem isso o lado
  // Compras da razão ficava truncado, distorcendo o indicador principal.
  const corte = limiteJanelaQuente()
  const compIniRpc = compIni < corte ? corte : compIni
  const comp = await rpcTodos<LinhaMatriz>(supabase, 'relatorio_compras_matriz', {
    p_loja_id: lojaId, p_ini: compIniRpc, p_fim: compFim, p_dim: 'cfop',
    p_familias: familiasSel.length ? familiasSel : null,
    p_produto: produtoTermo,
  })
  const comprasPorMes: Record<string, number> = {}
  for (const r of comp) {
    if (descreverCFOP(r.rotulo).cat === 'Ativo imobilizado') continue
    comprasPorMes[r.mes] = (comprasPorMes[r.mes] ?? 0) + (Number(r.valor) || 0)
  }

  // Complemento frio (Contabo) do lado Compras, para [compIni, corte).
  if (compIni < corte) {
    // Paginado: lojas com catálogo grande (ex.: 2, 3, 5, 6 têm >1000 produtos)
    // estourariam o corte padrão de 1000 linhas do PostgREST numa chamada única,
    // deixando produtos fora do mapa de tipo/família (mesma classe de bug do rpcTodos).
    type ProdMeta = { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }
    const prodMetaRaw: ProdMeta[] = []
    const PAGE = 1000
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('produtos').select('codigo_produto, tipo_item, descricao_familia').eq('loja_id', lojaId)
        .order('id').range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      prodMetaRaw.push(...(data as ProdMeta[]))
      if (data.length < PAGE) break
    }
    const meta = new Map<number, { tipo: string | null; familia: string | null }>()
    for (const p of prodMetaRaw) {
      meta.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
    }
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    const itensFrios = await buscarItensNFFrio({ lojaId, dataInicio: compIni, dataFinal: corteExcl })
    const filtrados = filtrarItensCompras(itensFrios, {
      familias: familiasSel, tipos: [], fornecedor: null, cfops: [], produto: produtoTermo, local: null,
    }, meta)
    for (const l of agregarComprasMatriz(filtrados, 'cfop', meta)) {
      if (descreverCFOP(l.rotulo).cat === 'Ativo imobilizado') continue
      comprasPorMes[l.mes] = (comprasPorMes[l.mes] ?? 0) + l.valor
    }
  }

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

  const exportParams = new URLSearchParams()
  if (filtroIni) exportParams.set('data_inicio', filtroIni)
  if (filtroFim) exportParams.set('data_final', filtroFim)
  const exportHref = `/relatorio-indicadores/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Fat × Compras"
          icon={Scale}
          description="Quanto você comprou para cada real vendido (BETA)"
          voltarHref="/relatorios"
          actions={
            <>
              <FiltrosGaveta
                basePath="/relatorio-indicadores"
                campos={campos}
                defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', produto: sp.produto ?? '', familia: sp.familia ?? '' }}
                persistirEm="/relatorio-indicadores"
              />
              <a href={exportHref} target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: Faturamento, Compras, Resultado e % mês a mês">
                <Download className="size-4" /> Baixar
              </a>
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/relatorio-indicadores" campos={campos} persistirEm="/relatorio-indicadores" />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Faturado <span className="num font-semibold text-text"><Money value={totFat} /></span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Comprado <span className="num font-semibold text-text"><Money value={totComp} /></span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Compras ÷ Fat <span className={`num font-semibold ${corMeta(pctTotal, metaPct)}`}>{fmtPct(pctTotal)}</span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Meta <span className="num font-semibold text-text">≤ {metaPct}%</span>
          {Number.isFinite(pctTotal) && (
            <span className={`ml-1 font-semibold ${corMeta(pctTotal, metaPct)}`}>
              {pctTotal <= metaPct ? '· no alvo' : `· ${(pctTotal - metaPct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p. acima`}
            </span>
          )}
        </span>
        {metaRow?.importado_em && (
          <span className="text-[13px] text-text-muted">Faturamento importado em {fmtQuando(metaRow.importado_em as string)}</span>
        )}
        {filtroAtivo && (
          <span className="text-[13px] font-medium text-brand">
            Indicadores filtrados — Compras e Faturamento restritos ao mesmo recorte
          </span>
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
                  const cls = ind.tipo === 'res' ? corRes(v) : ind.tipo === 'pct' ? corMeta(v, metaPct) : ind.destaque ? 'text-text' : 'text-text-muted'
                  return (
                    <td key={m} className={`num whitespace-nowrap px-3 py-2 text-right ${cls}`}>
                      {ind.tipo === 'pct' ? fmtPct(v) : fmtCelOrPct(v, 'money')}
                    </td>
                  )
                })}
                <td className={`num whitespace-nowrap px-3 py-2 text-right font-medium ${ind.tipo === 'res' ? corRes(ind.total) : ind.tipo === 'pct' ? corMeta(ind.total, metaPct) : 'text-text'}`}>
                  {ind.tipo === 'pct' ? fmtPct(ind.total) : fmtMoeda(ind.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-[11px] text-text-muted">
        Faturamento vem do import do FAT do Omie; Compras vem das NFs de entrada (valor do item), já sem bonificação/comodato
        e sem ativo imobilizado (compra de bem para a empresa é investimento, não gasto). &quot;Compras ÷ Faturamento&quot; é
        quanto você gastou comprando para cada real vendido. Meta: <span className="font-medium text-ok">≤ {metaPct}%</span> no alvo,
        <span className="font-medium text-warn"> até 50% atenção</span>, <span className="font-medium text-err">acima de 50% alto</span> (na indústria, alguns miram 35%).
        &quot;Faturamento − Compras&quot; não é lucro: Compras é a entrada de mercadoria do mês, não o custo do que foi consumido (margem real vem do Módulo de Margem).
      </p>
    </div>
  )
}
