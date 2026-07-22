import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { descreverCFOP } from '@/lib/cfop'
import { buscarFamilias } from '@/lib/actions/produto'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import {
  buscarItensNFFrio,
  filtrarItensCompras,
  agregarComprasTotal,
  agregarComprasMatriz,
  mapearComprasDetalhe,
  type ItemNFFrio,
  type MetaProdutoNF,
  type LinhaDetalheCompra,
} from '@/lib/relatorio-frio-nf'
import { parseDrill, hrefComDrill, SEM } from '@/lib/drill'
import { DrillBreadcrumb } from '@/components/ui-kit/DrillBreadcrumb'
import { explicarRotulo } from '@/lib/rotulos-opacos'
import { ShoppingCart, Download } from 'lucide-react'

// Converte lista vazia em null (RPC trata null como "sem filtro"; array vazio
// com `= any()` não bateria com nada).
const arrOrNull = (a: string[]): string[] | null => (a.length ? a : null)

// Dimensões de abertura do relatório (espelham as planilhas do Ramon).
const DIMS = [
  { value: 'familia', label: 'Família' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'produto', label: 'Produto' },
  { value: 'tipo', label: 'Tipo' },
  { value: 'cfop', label: 'CFOP' },
] as const

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (ym: string) => {
  const [a, m] = ym.split('-')
  return `${MESES_ABREV[Number(m) - 1] ?? m}/${a.slice(2)}`
}
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
// Célula mensal: número pt-BR sem "R$"; 0 vira "-" pra não poluir (como o Ramon).
const fmtCel = (n: number) => (n ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-')

function fmtData(d: string): string {
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}

// Quantas linhas (rótulos) a tela mostra; o resto fica no "Baixar tudo".
const LIMITE_LINHAS = 200

type LinhaMatriz = { rotulo: string; mes: string; valor: number }

export default async function RelatorioComprasPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    dim?: string
    familia?: string
    tipo?: string
    fornecedor?: string
    cfop?: string
    produto?: string
    local?: string
    drill?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  // Relatório com R$ de compras é sensível: só gestores (admin global ou de loja).
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const sp = await searchParams
  const dim = DIMS.some((d) => d.value === sp.dim) ? sp.dim! : 'familia'

  // Drill: qualquer dimensão -> produto -> itens. Cada par da trilha vira
  // filtro; a dimensão exibida desce a cadeia.
  const pares = parseDrill(sp.drill)
  const nivelItens = pares.some((p) => p.dim === 'produto') || (dim === 'produto' && pares.length > 0)
  const dimExibida = nivelItens ? null : pares.length > 0 ? 'produto' : dim

  // Padrão: ano corrente (1º de janeiro até hoje), em America/Bahia.
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO
  const familiasSel = valoresMulti(sp.familia)
  const tiposSel = valoresMulti(sp.tipo)
  const cfopsSel = valoresMulti(sp.cfop)
  const fornecedor = sp.fornecedor || null
  const produto = sp.produto || null
  const localCod = sp.local && !Number.isNaN(Number(sp.local)) ? Number(sp.local) : null
  const filtros = {
    p_familias: arrOrNull(familiasSel),
    p_tipos: arrOrNull(tiposSel),
    p_fornecedor: fornecedor,
    p_cfops: arrOrNull(cfopsSel),
    p_produto: produto,
    p_local: localCod,
  }
  // Pares da trilha sobrescrevem o filtro correspondente (drill restringe).
  const drillFiltros: Record<string, unknown> = {}
  for (const p of pares) {
    if (p.dim === 'familia') drillFiltros.p_familias = [p.rotulo === 'Sem classificação' ? SEM : p.rotulo]
    if (p.dim === 'tipo') drillFiltros.p_tipos = [p.rotulo === 'Sem classificação' ? SEM : p.rotulo]
    if (p.dim === 'fornecedor') drillFiltros.p_fornecedor = p.rotulo === 'Sem classificação' ? SEM : p.rotulo
    if (p.dim === 'cfop') drillFiltros.p_cfops = [p.rotulo === 'Sem classificação' ? SEM : p.rotulo]
    if (p.dim === 'produto' && p.rotulo !== SEM && p.rotulo !== 'Sem classificação') drillFiltros.p_produto = p.rotulo
  }
  const filtrosComDrill = { ...filtros, ...drillFiltros }

  const supabase = await createClient()
  // A matriz pode passar de 1000 linhas (PostgREST corta) em dim=produto: pagina.
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

  // A janela quente (Supabase) só cobre ~90 dias; a RPC nunca deve pedir algo
  // mais antigo (linhas já podadas), então clampa o início. A fatia antiga
  // (ini < corte) vem do Contabo, reagregada em JS abaixo.
  const corte = limiteJanelaQuente()
  const iniRpc = ini < corte ? corte : ini

  const [{ data: totalRows }, matrizRaw, { data: cfopDimRaw }] = await Promise.all([
    supabase.rpc('relatorio_compras_total', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, ...filtrosComDrill }),
    rpcTodos<LinhaMatriz>('relatorio_compras_matriz', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: dimExibida ?? 'produto', ...filtrosComDrill }),
    // Universo de CFOPs do período (sem os filtros de família/tipo/cfop), pra opções do filtro.
    supabase.rpc('relatorio_compras_dim', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: 'cfop' }),
  ])
  let total = Number((totalRows as { valor: number }[] | null)?.[0]?.valor ?? 0)
  let nNotas = Number((totalRows as { n_notas: number }[] | null)?.[0]?.n_notas ?? 0)

  // Complemento frio (Contabo) para o pedaço [ini, corte). Reaproveita a
  // reagregação em JS que espelha a RPC (lib/relatorio-frio-nf.ts).
  // filtrados/meta ficam acessíveis fora do if pro nível de itens reusar.
  let filtrados: ItemNFFrio[] = []
  let meta: MetaProdutoNF = new Map()
  if (ini < corte) {
    // O Supabase corta em 1000 linhas por padrão (sem erro) -- pagina até esgotar
    // (achado real: lojas com >1000 produtos perdiam o resto do catálogo aqui,
    // igual ao que já era feito no export/route.ts e export-completo/route.ts).
    const prodMetaRaw: { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }[] = []
    for (let pg = 0; ; pg++) {
      const from = pg * 1000
      const { data } = await supabase
        .from('produtos')
        .select('codigo_produto, tipo_item, descricao_familia')
        .eq('loja_id', lojaId)
        .range(from, from + 999)
      if (!data?.length) break
      prodMetaRaw.push(...data)
      if (data.length < 1000) break
    }
    meta = new Map()
    for (const p of prodMetaRaw) {
      meta.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
    }
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    // Achado real: se o período pedido termina antes do corte (fim < corteExcl —
    // ex.: um recorte todo dentro do histórico frio), usar corteExcl fixo aqui
    // buscava dado a mais no Contabo (até o corte, não até `fim`), inflando o
    // total. Trava no menor dos dois.
    const dataFinalFria = fim < corteExcl ? fim : corteExcl
    const itensFrios = await buscarItensNFFrio({ lojaId, dataInicio: ini, dataFinal: dataFinalFria })
    const fDrill = { familias: [...familiasSel], tipos: [...tiposSel], fornecedor, cfops: [...cfopsSel], produto, local: localCod }
    for (const p of pares) {
      const rot = p.rotulo === 'Sem classificação' ? SEM : p.rotulo
      if (p.dim === 'familia') fDrill.familias = [rot]
      if (p.dim === 'tipo') fDrill.tipos = [rot]
      if (p.dim === 'fornecedor') fDrill.fornecedor = rot
      if (p.dim === 'cfop') fDrill.cfops = [rot]
      if (p.dim === 'produto' && rot !== SEM) fDrill.produto = rot
    }
    filtrados = filtrarItensCompras(itensFrios, fDrill, meta)
    const totFrio = agregarComprasTotal(filtrados)
    total += totFrio.valor
    nNotas += totFrio.nNotas
    for (const l of agregarComprasMatriz(filtrados, dimExibida ?? 'produto', meta)) matrizRaw.push(l)
  }

  // Nível final: itens individuais (RPC de detalhe + pedaço frio mapeado).
  let itensDetalhe: LinhaDetalheCompra[] = []
  if (nivelItens) {
    const { data: det } = await supabase
      .rpc('relatorio_compras_detalhe', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, ...filtrosComDrill })
      .range(0, 499)
    itensDetalhe = (det ?? []) as LinhaDetalheCompra[]
    if (ini < corte) {
      itensDetalhe = [...mapearComprasDetalhe(filtrados, meta), ...itensDetalhe]
        .sort((a, b) => String(b.data).localeCompare(String(a.data)) || Number(b.total) - Number(a.total))
        .slice(0, 500)
    }
  }

  // Rótulo amigável conforme a dimensão EXIBIDA (tipo -> nome; produto -> título limpo).
  const rotuloDe = (raw: string): string => {
    if (dimExibida === 'tipo') return TIPO_LABEL.get(raw) ?? raw
    if (dimExibida === 'produto') return formatarNomeProduto(raw) || raw
    return raw
  }

  // Pivot: linha = rótulo, colunas = meses. Soma por mês e total geral.
  const meses = [...new Set(matrizRaw.map((m) => m.mes))].sort()
  const porRotulo = new Map<string, { total: number; meses: Record<string, number> }>()
  for (const r of matrizRaw) {
    const ent = porRotulo.get(r.rotulo) ?? { total: 0, meses: {} }
    const v = Number(r.valor) || 0
    ent.meses[r.mes] = (ent.meses[r.mes] ?? 0) + v
    ent.total += v
    porRotulo.set(r.rotulo, ent)
  }
  const ordenadas = [...porRotulo.entries()].sort((a, b) => b[1].total - a[1].total)
  const linhas = ordenadas.slice(0, LIMITE_LINHAS).map(([rotulo, ent]) => ({ rotuloRaw: rotulo, rotulo: rotuloDe(rotulo), meses: ent.meses, total: ent.total }))
  const ocultadas = ordenadas.length - linhas.length
  const totalPorMes: Record<string, number> = {}
  for (const [, ent] of porRotulo) for (const m of meses) totalPorMes[m] = (totalPorMes[m] ?? 0) + (ent.meses[m] ?? 0)
  const dimLabel = DIMS.find((d) => d.value === (dimExibida ?? dim))?.label ?? 'Item'

  const [familias, { data: locaisRaw }] = await Promise.all([
    buscarFamilias(),
    supabase
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .order('descricao'),
  ])
  // Opções de CFOP: só os que apareceram no período (bonificação/comodato já não
  // aparecem aqui, pois a RPC os exclui sempre; não contam como compra).
  const opcoesCfop = ((cfopDimRaw ?? []) as { rotulo: string }[]).map((r) => ({
    value: r.rotulo,
    label: `${r.rotulo} · ${descreverCFOP(r.rotulo).desc}`,
  }))
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo de mercadoria', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f.descricao, label: f.descricao })) },
    { tipo: 'texto', nome: 'fornecedor', label: 'Fornecedor (nome)' },
    { tipo: 'multi-select', nome: 'cfop', label: 'CFOP', opcoes: opcoesCfop },
    {
      tipo: 'select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
  ]

  const exportParams = new URLSearchParams({ data_inicio: ini, data_final: fim, dim })
  if (sp.familia) exportParams.set('familia', sp.familia)
  if (sp.tipo) exportParams.set('tipo', sp.tipo)
  if (fornecedor) exportParams.set('fornecedor', fornecedor)
  if (sp.cfop) exportParams.set('cfop', sp.cfop)
  // Achado real: produto e local ficavam de fora daqui -- os filtros
  // funcionavam na tela (RPCs recebem tudo), mas o Excel/"Baixar tudo"
  // silenciosamente ignorava esses dois filtros porque a URL de export
  // nunca os carregava, mesmo as rotas de export já sabendo lê-los.
  if (produto) exportParams.set('produto', produto)
  if (sp.local) exportParams.set('local', sp.local)

  // Cabeçalho de coluna (th) padrão.
  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Compras"
          icon={ShoppingCart}
          description="Relatório de compras por NF de entrada (BETA)"
          voltarHref="/relatorios"
          actions={
            <>
              <FiltrosGaveta
                basePath="/relatorio-compras"
                campos={campos}
                defaults={{
                  data_inicio: sp.data_inicio ?? '',
                  data_final: sp.data_final ?? '',
                  produto: sp.produto ?? '',
                  local: sp.local ?? '',
                  tipo: sp.tipo ?? '',
                  familia: sp.familia ?? '',
                  fornecedor: sp.fornecedor ?? '',
                  cfop: sp.cfop ?? '',
                }}
                persistirEm="/relatorio-compras"
              />
              <a
                href={`/relatorio-compras/export?${exportParams.toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className={btnClass('outline')}
                title="Excel desta abertura: Resumo mês a mês + Detalhado (com filtros)"
              >
                <Download className="size-4" /> Excel
              </a>
              <a
                href={`/relatorio-compras/export-completo?${exportParams.toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className={btnClass('primary')}
                title="Pasta completa: matriz mês a mês por Tipo, Família, Fornecedor, CFOP e Produto + Detalhado"
              >
                <Download className="size-4" /> Baixar tudo
              </a>
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/relatorio-compras" campos={campos} persistirEm="/relatorio-compras" />
      </ListaHeader>

      {/* Total do período + abertura */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-text-muted">
          Período: {fmtData(ini)} a {fmtData(fim)}
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Total comprado <span className="num font-semibold text-text"><Money value={total} /></span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Notas <span className="num font-semibold text-text">{nNotas}</span>
        </span>
      </div>
      <p className="px-1 text-[11px] text-text-muted">
        Bonificação (CFOP 910) e comodato (CFOP 908) não contam como compra/gasto e não entram nestes números.
      </p>

      {pares.length === 0 ? (
        <SegmentLinks
          basePath="/relatorio-compras"
          param="dim"
          aria-label="Abrir compras por"
          opcoes={DIMS.map((d) => ({ value: d.value === 'familia' ? '' : d.value, label: d.label }))}
        />
      ) : (
        <DrillBreadcrumb
          basePath="/relatorio-compras"
          sp={sp}
          pares={pares}
          raiz={`Compras por ${(DIMS.find((d) => d.value === dim)?.label ?? dim).toLowerCase()}`}
          rotuloDe={(p) =>
            p.rotulo === SEM || p.rotulo === 'Sem classificação'
              ? explicarRotulo('Sem classificação')!.label
              : p.dim === 'tipo'
                ? TIPO_LABEL.get(p.rotulo) ?? p.rotulo
                : p.dim === 'produto'
                  ? formatarNomeProduto(p.rotulo) || p.rotulo
                  : p.rotulo
          }
        />
      )}

      {nivelItens ? (
        itensDetalhe.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Sem itens neste recorte" hint="Ajuste o período ou volte um nível na trilha." />
        ) : (
          <div className="space-y-1.5">
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-2">
                    <th className={`text-left ${th}`}>Data</th>
                    <th className={`text-left ${th}`}>NF</th>
                    <th className={`text-left ${th}`}>Fornecedor</th>
                    <th className={`text-left ${th}`}>Produto</th>
                    <th className={`text-left ${th}`}>CFOP</th>
                    <th className={`text-right ${th}`}>Qtde</th>
                    <th className={`text-right ${th}`}>Unit.</th>
                    <th className={`text-right ${th}`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {itensDetalhe.map((it, i) => (
                    <tr key={`${it.nota}-${i}`} className="border-t border-border/60 hover:bg-surface-2/40">
                      <td className="num whitespace-nowrap px-3 py-2 text-text-muted">{fmtData(String(it.data).slice(0, 10))}</td>
                      <td className="num px-3 py-2 text-text-muted">{it.nota}</td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-text-muted" title={it.fornecedor ?? ''}>{it.fornecedor}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-text" title={it.produto ?? ''}>
                        <Link href={`/movimentacoes?produto=${encodeURIComponent(it.produto ?? '')}`} className="hover:underline">
                          {formatarNomeProduto(it.produto ?? '') || it.produto}
                        </Link>
                      </td>
                      <td className="num px-3 py-2 text-text-muted">{it.cfop || '-'}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{Number(it.qtde).toLocaleString('pt-BR')}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtCel(Number(it.preco_unit))}</td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{fmtMoeda(Number(it.total))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-surface-2/70 font-semibold">
                    <td className="px-3 py-2 text-text" colSpan={7}>Total dos itens listados</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmtMoeda(itensDetalhe.reduce((s, it) => s + Number(it.total), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {itensDetalhe.length >= 500 && (
              <p className="px-1 text-[11px] text-text-muted">Mostrando os 500 itens mais recentes — use o Excel pra lista completa.</p>
            )}
          </div>
        )
      ) : linhas.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Sem compras no período"
          hint="Ajuste o período. O histórico de NF de entrada cobre cerca de 1 ano."
        />
      ) : (
        <div className="space-y-1.5">
          {/* Matriz mês a mês: 1ª coluna fixa, meses rolam na horizontal */}
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>{dimLabel}</th>
                  {meses.map((m) => (
                    <th key={m} className={`text-right ${th}`}>{mesLabel(m)}</th>
                  ))}
                  <th className={`text-right ${th}`}>Total</th>
                  <th className={`text-right ${th}`}>%</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const opaco = explicarRotulo(l.rotuloRaw)
                  const parNovo = { dim: dimExibida ?? dim, rotulo: l.rotuloRaw === 'Sem classificação' ? SEM : l.rotuloRaw }
                  return (
                  <tr key={l.rotulo} className="border-t border-border/60 hover:bg-surface-2/40">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={opaco?.motivo ?? l.rotulo}>
                      <div className="max-w-[140px] truncate">
                        <Link href={hrefComDrill('/relatorio-compras', sp, [...pares, parNovo])} className="hover:underline">
                          {opaco?.label ?? l.rotulo}
                          {opaco && <span className="ml-1 text-text-muted" aria-hidden>ⓘ</span>}
                        </Link>
                      </div>
                    </td>
                    {meses.map((m) => (
                      <td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-text-muted">{fmtCel(l.meses[m] ?? 0)}</td>
                    ))}
                    <td className="num whitespace-nowrap px-2 py-1.5 text-right font-medium text-text">{fmtMoeda(l.total)}</td>
                    <td className="num whitespace-nowrap px-2 py-1.5 text-right text-text-muted">
                      {total > 0 ? `${((l.total / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-'}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-2/70 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-text"><div className="max-w-[140px] truncate">Total</div></td>
                  {meses.map((m) => (
                    <td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-text">{fmtCel(totalPorMes[m] ?? 0)}</td>
                  ))}
                  <td className="num whitespace-nowrap px-2 py-1.5 text-right text-text">{fmtMoeda(total)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
          {ocultadas > 0 && (
            <p className="px-1 text-[11px] text-text-muted">
              Mostrando os {LIMITE_LINHAS} maiores de {ordenadas.length}. Use &quot;Baixar tudo&quot; para o completo.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
