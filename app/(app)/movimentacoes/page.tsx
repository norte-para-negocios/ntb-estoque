import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { Num } from '@/components/ui-kit/Num'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { buscarFamilias } from '@/lib/actions/produto'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { ArrowLeftRight } from 'lucide-react'

const POR_PAGINA = 100

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = String(d).slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
}

// Historico de movimentacoes de estoque (entradas/saidas por produto/dia),
// importado do Omie (movimentos_historico). Default: ultimos 30 dias.
export default async function MovimentacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ data_inicio?: string; data_final?: string; produto?: string; familia?: string; tipo?: string; page?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = sp.data_inicio || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const fim = sp.data_final || hojeISO

  const supabase = await createClient()

  // Tipo/familia nao existem em movimentos_historico -> resolve os codigos dos
  // produtos que batem e restringe os movimentos a eles.
  let codigosFiltro: number[] | null = null
  if (sp.tipo || sp.familia) {
    let pq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    if (sp.tipo) pq = pq.eq('tipo_item', sp.tipo)
    if (sp.familia) pq = pq.eq('descricao_familia', sp.familia)
    const { data } = await pq
    codigosFiltro = [...new Set((data ?? []).map((p) => p.codigo_produto).filter(Boolean))]
  }
  const codigosIn = codigosFiltro ? (codigosFiltro.length ? codigosFiltro : [-1]) : null
  const termo = sp.produto ? escapeIlikeOr(sp.produto) : null

  let query = supabase
    .from('movimentos_historico')
    .select('cod_prod, codigo, descricao, data, entradas, saidas')
    .eq('loja_id', lojaId)
    .gte('data', ini)
    .lte('data', fim)
    .order('data', { ascending: false })
    .order('saidas', { ascending: false })
    .range((page - 1) * POR_PAGINA, page * POR_PAGINA)
  if (termo) query = query.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
  if (codigosIn) query = query.in('cod_prod', codigosIn)
  const { data: movsRaw } = await query
  const temProxima = (movsRaw?.length ?? 0) > POR_PAGINA
  const movs = temProxima ? movsRaw!.slice(0, POR_PAGINA) : movsRaw

  // Totais do periodo/filtro (busca so as 2 colunas e soma) — resumo no topo.
  let totaisQuery = supabase
    .from('movimentos_historico')
    .select('entradas, saidas')
    .eq('loja_id', lojaId)
    .gte('data', ini)
    .lte('data', fim)
    .limit(100000)
  if (termo) totaisQuery = totaisQuery.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
  if (codigosIn) totaisQuery = totaisQuery.in('cod_prod', codigosIn)
  const { data: totaisRaw } = await totaisQuery
  const totalEntradas = (totaisRaw ?? []).reduce((a, r) => a + (Number(r.entradas) || 0), 0)
  const totalSaidas = (totaisRaw ?? []).reduce((a, r) => a + (Number(r.saidas) || 0), 0)

  const familias = await buscarFamilias()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Movimentações"
        icon={ArrowLeftRight}
        description="Histórico de entradas e saídas por produto (2026)"
        actions={
          <FiltrosGaveta
            basePath="/movimentacoes"
            campos={[
              { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
              { tipo: 'data', nome: 'data_final', label: 'Data final' },
              { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
              { tipo: 'select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
              { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f.descricao, label: f.descricao })) },
            ]}
            defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', produto: sp.produto ?? '', tipo: sp.tipo ?? '', familia: sp.familia ?? '' }}
            naoContar={['data_inicio', 'data_final']}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-text-muted">Período: {fmtData(ini)} a {fmtData(fim)}</span>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-[13px] text-text-muted">
          Entradas{' '}
          <span className="num font-semibold text-[#10b981]">
            <Num value={totalEntradas} frac={0} />
          </span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-[13px] text-text-muted">
          Saídas{' '}
          <span className="num font-semibold text-[var(--err)]">
            <Num value={totalSaidas} frac={0} />
          </span>
        </span>
      </div>

      <Lista
        linhas={movs ?? []}
        chaveLinha={(m) => `${m.cod_prod}-${m.data}`}
        colunas={[
          { label: 'Data', larguraDesktop: 'w-28', render: (m) => <span className="num text-text-muted">{fmtData(m.data)}</span> },
          {
            label: 'Produto',
            primaria: true,
            flexivel: true,
            render: (m) => (
              <span>
                <span className="num text-text-muted">{m.codigo}</span> {formatarNomeProduto(m.descricao) || `Produto ${m.cod_prod}`}
              </span>
            ),
          },
          {
            label: 'Entradas',
            alinhar: 'right',
            larguraDesktop: 'w-28',
            render: (m) =>
              m.entradas > 0 ? <span className="num font-medium text-[#10b981]"><Num value={m.entradas} frac={0} /></span> : <span className="text-text-muted">-</span>,
          },
          {
            label: 'Saídas',
            alinhar: 'right',
            larguraDesktop: 'w-28',
            render: (m) =>
              m.saidas > 0 ? <span className="num font-medium text-[var(--err)]"><Num value={m.saidas} frac={0} /></span> : <span className="text-text-muted">-</span>,
          },
        ]}
        vazio={
          <EmptyState
            icon={ArrowLeftRight}
            title="Nenhuma movimentação"
            hint="Ajuste o período ou o produto. O histórico cobre 2026."
          />
        }
      />

      {(page > 1 || temProxima) && <Paginacao basePath="/movimentacoes" page={page} temProxima={temProxima} />}
    </div>
  )
}
