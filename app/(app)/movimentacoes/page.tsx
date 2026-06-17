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
  searchParams: Promise<{ data_inicio?: string; data_final?: string; produto?: string; page?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = sp.data_inicio || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const fim = sp.data_final || hojeISO

  const supabase = await createClient()
  let query = supabase
    .from('movimentos_historico')
    .select('cod_prod, codigo, descricao, data, entradas, saidas')
    .eq('loja_id', lojaId)
    .gte('data', ini)
    .lte('data', fim)
    .order('data', { ascending: false })
    .order('saidas', { ascending: false })
    .range((page - 1) * POR_PAGINA, page * POR_PAGINA)

  if (sp.produto) {
    const q = escapeIlikeOr(sp.produto)
    query = query.or(`descricao.ilike.%${q}%,codigo.ilike.%${q}%`)
  }

  const { data: movsRaw } = await query
  const temProxima = (movsRaw?.length ?? 0) > POR_PAGINA
  const movs = temProxima ? movsRaw!.slice(0, POR_PAGINA) : movsRaw

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
            ]}
            defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', produto: sp.produto ?? '' }}
          />
        }
      />

      <div className="text-[13px] text-text-muted">
        Período: {fmtData(ini)} a {fmtData(fim)}
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
