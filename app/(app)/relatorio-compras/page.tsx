import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { ShoppingCart, Download } from 'lucide-react'

// Dimensões de abertura do relatório (espelham as planilhas do Ramon).
const DIMS = [
  { value: 'familia', label: 'Família' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'produto', label: 'Produto' },
  { value: 'tipo', label: 'Tipo' },
] as const

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))

function fmtData(d: string): string {
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}

type LinhaDim = { rotulo: string; valor: number; itens: number }

export default async function RelatorioComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ data_inicio?: string; data_final?: string; dim?: string }>
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

  const supabase = await createClient()
  const [{ data: totalRows }, { data: linhasRaw }] = await Promise.all([
    supabase.rpc('relatorio_compras_total', { p_loja_id: lojaId, p_ini: ini, p_fim: fim }),
    supabase.rpc('relatorio_compras_dim', { p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_dim: dim }),
  ])
  const total = Number((totalRows as { valor: number }[] | null)?.[0]?.valor ?? 0)
  const nNotas = Number((totalRows as { n_notas: number }[] | null)?.[0]?.n_notas ?? 0)
  const linhas = ((linhasRaw ?? []) as LinhaDim[]).map((l) => ({ ...l, valor: Number(l.valor) }))

  // Rótulo amigável conforme a dimensão (tipo -> nome do SPED; produto -> título limpo).
  const rotuloDe = (l: LinhaDim): string => {
    if (dim === 'tipo') return TIPO_LABEL.get(l.rotulo) ?? l.rotulo
    if (dim === 'produto') return formatarNomeProduto(l.rotulo) || l.rotulo
    return l.rotulo
  }

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
  ]

  const exportParams = new URLSearchParams({ data_inicio: ini, data_final: fim, dim })

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
                defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '' }}
                persistirEm="/relatorio-compras"
              />
              <a
                href={`/relatorio-compras/export?${exportParams.toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className={btnClass('outline')}
              >
                <Download className="size-4" /> Excel
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

      <Lista
        linhas={linhas}
        chaveLinha={(l) => l.rotulo}
        colunas={[
          {
            label: DIMS.find((d) => d.value === dim)?.label ?? 'Item',
            primaria: true,
            flexivel: true,
            render: (l) => <span>{rotuloDe(l)}</span>,
          },
          {
            label: 'Itens',
            alinhar: 'right',
            larguraDesktop: 'w-24',
            render: (l) => <span className="num text-text-muted">{l.itens}</span>,
          },
          {
            label: '% do total',
            alinhar: 'right',
            larguraDesktop: 'w-28',
            render: (l) => (
              <span className="num text-text-muted">
                {total > 0 ? `${((l.valor / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-'}
              </span>
            ),
          },
          {
            label: 'Comprado',
            alinhar: 'right',
            larguraDesktop: 'w-32',
            render: (l) => <Money value={l.valor} className="font-medium" />,
          },
        ]}
        vazio={
          <EmptyState
            icon={ShoppingCart}
            title="Sem compras no período"
            hint="Ajuste o período. O histórico de NF de entrada cobre cerca de 1 ano."
          />
        }
      />
    </div>
  )
}
