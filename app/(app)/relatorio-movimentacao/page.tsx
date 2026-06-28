import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { btnClass } from '@/components/ui-kit/Button'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { ArrowDownUp, Download, AlertTriangle } from 'lucide-react'

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (ym: string) => { const [a, m] = ym.split('-'); return `${MESES_ABREV[Number(m) - 1] ?? m}/${a.slice(2)}` }
const fmtData = (d: string) => { const [a, m, dia] = d.split('-'); return `${dia}/${m}/${a}` }
const fmtQtd = (n: number) => (n ? n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '-')
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtQuando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })

const LIMITE_LINHAS = 200
type LinhaMatriz = { rotulo: string; mes: string; qtde: number; valor: number }
type LinhaOper = { origem: string; sentido: 'E' | 'S'; local: string; tipo_sped: string; familia: string; mes: string; inventario: boolean; qtde: number; valor: number }

// O valor do PDV na SAÍDA é lixo (CMC podre de produto acabado -> valores
// astronômicos). Para tudo o mais, o valor do Omie é confiável.
const valorConfiavel = (origem: string, sentido: 'E' | 'S') => !(/pdv/i.test(origem) && sentido === 'S')

export default async function RelatorioMovimentacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ data_inicio?: string; data_final?: string; sentido?: string; modo?: string; op?: string; loc?: string; sent?: string; dim?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const sp = await searchParams
  const modo = sp.modo === 'operacao' ? 'operacao' : 'quantidade'
  const supabase = createServiceClient()

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  const seg = (
    <SegmentLinks
      basePath="/relatorio-movimentacao"
      param="modo"
      aria-label="Modo"
      opcoes={[
        { value: '', label: 'Em quantidade (produto)' },
        { value: 'operacao', label: 'Por operação (R$)' },
      ]}
    />
  )

  // ---------- Modo: Por operação (R$) — vem da aba BD do MOV_DRV ----------
  if (modo === 'operacao') {
    // O agregado tem ~milhares de linhas; o PostgREST corta em 1000 por padrão.
    // Pagina para trazer TODAS (senão os totais saem subcontados).
    async function selTodos(): Promise<LinhaOper[]> {
      const PAGE = 1000
      const todos: LinhaOper[] = []
      for (let p = 0; ; p++) {
        const { data, error } = await supabase
          .from('movimentacao_operacao')
          .select('origem, sentido, local, tipo_sped, familia, mes, inventario, qtde, valor')
          .eq('loja_id', lojaId)
          .order('valor', { ascending: false })
          .range(p * PAGE, p * PAGE + PAGE - 1)
        if (error || !data?.length) break
        todos.push(...(data as LinhaOper[]))
        if (data.length < PAGE) break
      }
      return todos
    }
    const [rows, { data: metaRow }] = await Promise.all([
      selTodos(),
      supabase.from('movimentacao_operacao_meta').select('importado_em').eq('loja_id', lojaId).maybeSingle(),
    ])

    // Filtros (selects): operação, local, sentido. Dimensão da matriz: família/local/tipo.
    const sent = sp.sent === 'E' ? 'E' : sp.sent === 'S' ? 'S' : ''
    const dim = sp.dim === 'local' ? 'local' : sp.dim === 'tipo_sped' ? 'tipo_sped' : 'familia'
    const origens = [...new Set(rows.map((r) => r.origem))].sort()
    const locais = [...new Set(rows.map((r) => r.local))].sort()

    const campos: CampoFiltro[] = [
      { tipo: 'select', nome: 'op', label: 'Operação', opcoes: origens.map((o) => ({ value: o, label: o })) },
      { tipo: 'select', nome: 'loc', label: 'Local de estoque', opcoes: locais.map((l) => ({ value: l, label: l })) },
      { tipo: 'select', nome: 'sent', label: 'Sentido', opcoes: [{ value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }] },
    ]

    const header = (
      <ListaHeader>
        <PageHeader
          title="Movimentação"
          icon={ArrowDownUp}
          description="Por operação, local e tipo — em R$ (importado do MOV_DRV) — BETA"
          actions={
            <>
              <FiltrosGaveta
                basePath="/relatorio-movimentacao"
                campos={campos}
                defaults={{ op: sp.op ?? '', loc: sp.loc ?? '', sent: sent }}
                persistirEm="/relatorio-movimentacao-op"
              />
              <a
                href={`/relatorio-movimentacao/export?modo=operacao${sp.op ? `&op=${encodeURIComponent(sp.op)}` : ''}${sp.loc ? `&loc=${encodeURIComponent(sp.loc)}` : ''}${sent ? `&sent=${sent}` : ''}&dim=${dim}`}
                target="_blank" rel="noopener noreferrer" className={btnClass('outline')}
                title="Excel: operações + perdas + matriz (com filtros)"
              >
                <Download className="size-4" /> Baixar
              </a>
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/relatorio-movimentacao" campos={campos} persistirEm="/relatorio-movimentacao-op" />
      </ListaHeader>
    )

    if (!rows.length) {
      return (
        <div className="space-y-4">
          {header}
          {seg}
          <EmptyState
            icon={ArrowDownUp}
            title="Sem movimentação por operação importada"
            hint='A operação (compra, perda, OP, PDV) e o local só vêm da aba "BD" do MOV_DRV do Omie. Esse arquivo é grande — a importação é feita pelo suporte (script). Fale com o Joaquim para atualizar.'
          />
        </div>
      )
    }

    // --- Cards executivos (sempre sobre TODOS os dados, visão de gestão) ---
    const somaSe = (fn: (r: LinhaOper) => boolean) => rows.filter(fn).reduce((s, r) => s + Number(r.valor), 0)
    const perdasReais = somaSe((r) => r.origem === 'Movimento Manual de Estoque' && r.sentido === 'S' && !r.inventario)
    const ajusteInv = somaSe((r) => r.origem === 'Movimento Manual de Estoque' && r.sentido === 'S' && r.inventario)
    const compras = somaSe((r) => /compra/i.test(r.origem) && r.sentido === 'E')
    const consumoOP = somaSe((r) => /consumo da ordem/i.test(r.origem) && r.sentido === 'S')

    // --- Tabela por operação (origem × sentido), respeitando filtro de local ---
    const baseLocal = sp.loc ? rows.filter((r) => r.local === sp.loc) : rows
    const porOper = new Map<string, { origem: string; sentido: 'E' | 'S'; qtde: number; valor: number; conf: boolean }>()
    for (const r of baseLocal) {
      const k = `${r.origem}|${r.sentido}`
      const e = porOper.get(k) ?? { origem: r.origem, sentido: r.sentido, qtde: 0, valor: 0, conf: valorConfiavel(r.origem, r.sentido) }
      e.qtde += Number(r.qtde); e.valor += Number(r.valor)
      porOper.set(k, e)
    }
    const opers = [...porOper.values()].sort((a, b) => (b.conf ? b.valor : 0) - (a.conf ? a.valor : 0))
    const totalOperValor = opers.filter((o) => o.conf).reduce((s, o) => s + o.valor, 0)

    // --- Matriz mês a mês pela dimensão escolhida, com filtros op/loc/sent ---
    const filtradas = rows.filter((r) =>
      (!sp.op || r.origem === sp.op) && (!sp.loc || r.local === sp.loc) && (!sent || r.sentido === sent)
    )
    // Se o recorte ficou só com PDV-saída (valor lixo), a matriz mostra QUANTIDADE.
    const soPdvSaida = filtradas.length > 0 && filtradas.every((r) => !valorConfiavel(r.origem, r.sentido))
    const usarQtde = soPdvSaida
    const meses = [...new Set(filtradas.map((r) => r.mes))].sort()
    const porDim = new Map<string, { total: number; meses: Record<string, number> }>()
    for (const r of filtradas) {
      const rot = (dim === 'local' ? r.local : dim === 'tipo_sped' ? r.tipo_sped : r.familia) || 'N/D'
      const v = usarQtde ? Number(r.qtde) : (valorConfiavel(r.origem, r.sentido) ? Number(r.valor) : 0)
      const ent = porDim.get(rot) ?? { total: 0, meses: {} }
      ent.meses[r.mes] = (ent.meses[r.mes] ?? 0) + v
      ent.total += v
      porDim.set(rot, ent)
    }
    const linhasDim = [...porDim.entries()].filter(([, e]) => e.total !== 0).sort((a, b) => b[1].total - a[1].total)
    const totalPorMes: Record<string, number> = {}
    for (const [, e] of linhasDim) for (const m of meses) totalPorMes[m] = (totalPorMes[m] ?? 0) + (e.meses[m] ?? 0)
    const totalGeral = Object.values(totalPorMes).reduce((s, v) => s + v, 0)
    const fmtCel = usarQtde ? fmtQtd : (n: number) => (n ? fmtMoeda(n) : '-')

    const cardCls = 'rounded-lg border border-border bg-surface px-3.5 py-3'
    const dimLabel = dim === 'local' ? 'Local' : dim === 'tipo_sped' ? 'Tipo (SPED)' : 'Família'

    return (
      <div className="space-y-4">
        {header}
        {seg}

        {/* Cards executivos */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <div className={cardCls}>
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-err">
              <AlertTriangle className="size-3.5" /> Perdas reais
            </p>
            <p className="num mt-1 text-[15px] font-semibold text-text">{fmtMoeda(perdasReais)}</p>
            <p className="text-[12px] text-text-muted">baixa manual (fora inventário)</p>
          </div>
          <div className={cardCls}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-warn">Ajuste por inventário</p>
            <p className="num mt-1 text-[15px] font-semibold text-text">{fmtMoeda(ajusteInv)}</p>
            <p className="text-[12px] text-text-muted">baixa manual por contagem</p>
          </div>
          <div className={cardCls}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-info">Compras (entrada)</p>
            <p className="num mt-1 text-[15px] font-semibold text-text">{fmtMoeda(compras)}</p>
            <p className="text-[12px] text-text-muted">entrada por nota</p>
          </div>
          <div className={cardCls}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Consumo de OP</p>
            <p className="num mt-1 text-[15px] font-semibold text-text">{fmtMoeda(consumoOP)}</p>
            <p className="text-[12px] text-text-muted">insumo consumido na produção</p>
          </div>
        </div>

        {/* Tabela por operação */}
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2">
                <th className={`text-left ${th}`}>Operação{sp.loc ? ` · ${sp.loc}` : ''}</th>
                <th className={`text-left ${th}`}>Sentido</th>
                <th className={`text-right ${th}`}>Quantidade</th>
                <th className={`text-right ${th}`}>Valor</th>
                <th className={`text-right ${th}`}>%</th>
              </tr>
            </thead>
            <tbody>
              {opers.map((o) => (
                <tr key={`${o.origem}|${o.sentido}`} className="border-t border-border/60 hover:bg-surface-2/40">
                  <td className="max-w-[280px] truncate px-3 py-2 text-text" title={o.origem}>{o.origem}</td>
                  <td className="px-3 py-2 text-text-muted">{o.sentido === 'E' ? 'Entrada' : 'Saída'}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtQtd(o.qtde)}</td>
                  <td className={`num whitespace-nowrap px-3 py-2 text-right ${o.conf ? 'font-medium text-text' : 'text-text-muted'}`}>
                    {o.conf ? fmtMoeda(o.valor) : 'não-confiável'}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">
                    {o.conf && totalOperValor > 0 ? `${((o.valor / totalOperValor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-1 text-[11px] text-text-muted">
          O valor do PDV na saída não é confiável (custo médio de produto acabado fica distorcido no Omie) — use o modo &quot;Em quantidade&quot; para volume de venda.
          {metaRow?.importado_em && <> · Importado em {fmtQuando(metaRow.importado_em as string)}.</>}
        </p>

        {/* Matriz mês a mês pela dimensão */}
        <SegmentLinks
          basePath="/relatorio-movimentacao"
          param="dim"
          aria-label="Dimensão"
          opcoes={[
            { value: '', label: 'Por família' },
            { value: 'local', label: 'Por local' },
            { value: 'tipo_sped', label: 'Por tipo (SPED)' },
          ]}
        />

        {linhasDim.length === 0 ? (
          <EmptyState icon={ArrowDownUp} title="Sem dados no recorte" hint="Ajuste os filtros de operação, local e sentido." />
        ) : (
          <div className="space-y-1.5">
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[600px] border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-2">
                    <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>{dimLabel}</th>
                    {meses.map((m) => (<th key={m} className={`text-right ${th}`}>{mesLabel(m)}</th>))}
                    <th className={`text-right ${th}`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasDim.slice(0, LIMITE_LINHAS).map(([rot, e]) => (
                    <tr key={rot} className="border-t border-border/60 hover:bg-surface-2/40">
                      <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={rot}><div className="max-w-[140px] truncate">{formatarNomeProduto(rot) || rot}</div></td>
                      {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-text-muted">{fmtCel(e.meses[m] ?? 0)}</td>))}
                      <td className="num whitespace-nowrap px-2 py-1.5 text-right font-medium text-text">{fmtCel(e.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-surface-2/70 font-semibold">
                    <td className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-text"><div className="max-w-[140px] truncate">Total</div></td>
                    {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-text">{fmtCel(totalPorMes[m] ?? 0)}</td>))}
                    <td className="num whitespace-nowrap px-2 py-1.5 text-right text-text">{fmtCel(totalGeral)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="px-1 text-[11px] text-text-muted">
              {usarQtde
                ? 'Recorte só com PDV na saída: mostrando QUANTIDADE (valor não-confiável).'
                : 'Valores em R$ por mês. O PDV na saída entra como 0 (valor distorcido no Omie).'}
              {linhasDim.length > LIMITE_LINHAS && ` Mostrando as ${LIMITE_LINHAS} maiores de ${linhasDim.length}.`}
            </p>
          </div>
        )}
      </div>
    )
  }

  // ---------- Modo: Em quantidade (por produto, dado nativo) ----------
  const exportQs = new URLSearchParams()
  if (sp.data_inicio) exportQs.set('data_inicio', sp.data_inicio)
  if (sp.data_final) exportQs.set('data_final', sp.data_final)
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
  ]
  const header = (
    <ListaHeader>
      <PageHeader
        title="Movimentação"
        icon={ArrowDownUp}
        description="Consumo e baixas — em quantidade por produto ou em R$ por operação (BETA)"
        actions={
          <>
            <FiltrosGaveta
              basePath="/relatorio-movimentacao"
              campos={campos}
              defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '' }}
              persistirEm="/relatorio-movimentacao"
            />
            <a href={`/relatorio-movimentacao/export${exportQs.toString() ? `?${exportQs}` : ''}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: saídas/entradas por produto (com filtros)">
              <Download className="size-4" /> Baixar
            </a>
          </>
        }
      />
      <ChipsFiltrosAtivos basePath="/relatorio-movimentacao" campos={campos} persistirEm="/relatorio-movimentacao" />
    </ListaHeader>
  )

  const sentido = sp.sentido === 'entradas' ? 'entradas' : 'saidas'
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO

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

  return (
    <div className="space-y-4">
      {header}
      {seg}

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
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={l.rotulo}><div className="max-w-[140px] truncate">{l.rotulo}</div></td>
                    {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-[12px] text-text-muted">{fmtQtd(l.meses[m] ?? 0)}</td>))}
                    <td className="num whitespace-nowrap px-2 py-1.5 text-right text-[12px] font-medium text-text">{fmtQtd(l.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-2/70 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-text"><div className="max-w-[140px] truncate">Total (qtde)</div></td>
                  {meses.map((m) => (<td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-[12px] text-text">{fmtQtd(totalPorMes[m] ?? 0)}</td>))}
                  <td className="num whitespace-nowrap px-2 py-1.5 text-right text-[12px] text-text">{fmtQtd(Object.values(totalPorMes).reduce((s, v) => s + v, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="px-1 text-[11px] text-text-muted">
            Em quantidade (a soma por mês mistura unidades; vale como volume total). Para R$, use o modo &quot;Por operação&quot;.
            {ocultadas > 0 && ` Mostrando os ${LIMITE_LINHAS} maiores de ${ordenadas.length}.`}
          </p>
        </div>
      )}
    </div>
  )
}
