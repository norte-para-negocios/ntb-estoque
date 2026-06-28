import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { buscarFamilias } from '@/lib/actions/produto'
import { ShoppingCart, Download } from 'lucide-react'

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
  }>
}) {
  const lojaId = await getCurrentLojaId()
  // Relatório com R$ de compras é sensível: só gestores (admin global ou de loja).
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const sp = await searchParams
  const dim = DIMS.some((d) => d.value === sp.dim) ? sp.dim! : 'familia'

  // Padrão: ano corrente (1º de janeiro até hoje), em America/Bahia.
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO
  const familia = sp.familia || null
  const tipo = sp.tipo || null
  const fornecedor = sp.fornecedor || null
  const filtros = { p_familia: familia, p_tipo: tipo, p_fornecedor: fornecedor }

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

  const [{ data: totalRows }, matrizRaw] = await Promise.all([
    supabase.rpc('relatorio_compras_total', { p_loja_id: lojaId, p_ini: ini, p_fim: fim, ...filtros }),
    rpcTodos<LinhaMatriz>('relatorio_compras_matriz', { p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_dim: dim, ...filtros }),
  ])
  const total = Number((totalRows as { valor: number }[] | null)?.[0]?.valor ?? 0)
  const nNotas = Number((totalRows as { n_notas: number }[] | null)?.[0]?.n_notas ?? 0)

  // Rótulo amigável conforme a dimensão (tipo -> nome do SPED; produto -> título limpo).
  const rotuloDe = (raw: string): string => {
    if (dim === 'tipo') return TIPO_LABEL.get(raw) ?? raw
    if (dim === 'produto') return formatarNomeProduto(raw) || raw
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
  const linhas = ordenadas.slice(0, LIMITE_LINHAS).map(([rotulo, ent]) => ({ rotulo: rotuloDe(rotulo), meses: ent.meses, total: ent.total }))
  const ocultadas = ordenadas.length - linhas.length
  const totalPorMes: Record<string, number> = {}
  for (const [, ent] of porRotulo) for (const m of meses) totalPorMes[m] = (totalPorMes[m] ?? 0) + (ent.meses[m] ?? 0)
  const dimLabel = DIMS.find((d) => d.value === dim)?.label ?? 'Item'

  const familias = await buscarFamilias()
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'select', nome: 'tipo', label: 'Tipo de mercadoria', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f.descricao, label: f.descricao })) },
    { tipo: 'texto', nome: 'fornecedor', label: 'Fornecedor (nome)' },
  ]

  const exportParams = new URLSearchParams({ data_inicio: ini, data_final: fim, dim })
  if (familia) exportParams.set('familia', familia)
  if (tipo) exportParams.set('tipo', tipo)
  if (fornecedor) exportParams.set('fornecedor', fornecedor)

  // Cabeçalho de coluna (th) padrão.
  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Compras"
          icon={ShoppingCart}
          description="Relatório de compras por NF de entrada (BETA)"
          actions={
            <>
              <FiltrosGaveta
                basePath="/relatorio-compras"
                campos={campos}
                defaults={{
                  data_inicio: sp.data_inicio ?? '',
                  data_final: sp.data_final ?? '',
                  tipo: sp.tipo ?? '',
                  familia: sp.familia ?? '',
                  fornecedor: sp.fornecedor ?? '',
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

      <SegmentLinks
        basePath="/relatorio-compras"
        param="dim"
        aria-label="Abrir compras por"
        opcoes={DIMS.map((d) => ({ value: d.value === 'familia' ? '' : d.value, label: d.label }))}
      />

      {linhas.length === 0 ? (
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
                {linhas.map((l) => (
                  <tr key={l.rotulo} className="border-t border-border/60 hover:bg-surface-2/40">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={l.rotulo}>
                      <div className="max-w-[140px] truncate">{l.rotulo}</div>
                    </td>
                    {meses.map((m) => (
                      <td key={m} className="num whitespace-nowrap px-2 py-1.5 text-right text-text-muted">{fmtCel(l.meses[m] ?? 0)}</td>
                    ))}
                    <td className="num whitespace-nowrap px-2 py-1.5 text-right font-medium text-text">{fmtMoeda(l.total)}</td>
                    <td className="num whitespace-nowrap px-2 py-1.5 text-right text-text-muted">
                      {total > 0 ? `${((l.total / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-'}
                    </td>
                  </tr>
                ))}
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
