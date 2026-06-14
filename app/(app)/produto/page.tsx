import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SyncButton } from '@/components/SyncButton'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { Money } from '@/components/ui-kit/Money'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { btnClass } from '@/components/ui-kit/Button'
import { Package, Download } from 'lucide-react'

const POR_PAGINA = 100
const ALVOS = [40, 50, 60]

function fmtTimestamp(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('pt-BR')
}

// Margem real = (venda - custo) / venda
function margem(venda: number | null, custo: number | null): number | null {
  if (!venda || !custo) return null
  return (venda - custo) / venda
}

// Preço necessário para atingir a margem alvo
function precoSugerido(custo: number | null, alvo: number): number | null {
  if (!custo || alvo >= 1) return null
  return custo / (1 - alvo)
}

function corMargem(m: number): string {
  if (m <= 0) return '#ef4444'
  if (m < 0.2) return '#f59e0b'
  return '#10b981'
}

export default async function ProdutoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; familia?: string; tipo?: string; margem?: string; page?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const alvoPct = ALVOS.includes(Number(params.margem)) ? Number(params.margem) : 50
  const alvo = alvoPct / 100
  const supabase = await createClient()
  const podeSync = await requirePermissao(lojaId, 'Produtos - Sincronizar')

  const { data: lojaSync } = await supabase
    .from('lojas')
    .select('produto_ultima_atualizacao, produto_status')
    .eq('id', lojaId)
    .single()

  const { data: familiasRows } = await supabase
    .from('produtos')
    .select('descricao_familia')
    .eq('loja_id', lojaId)
    .not('descricao_familia', 'is', null)
    .order('descricao_familia')

  const familiasOpcoes = Array.from(
    new Set((familiasRows ?? []).map((r) => r.descricao_familia).filter(Boolean) as string[]),
  ).map((f) => ({ value: f, label: f }))

  let query = supabase
    .from('produtos')
    .select('id, codigo_produto, codigo, descricao, descricao_familia, tipo_item, unidade, valor_unitario')
    .eq('loja_id', lojaId)
    .order('descricao')
    .range((page - 1) * POR_PAGINA, page * POR_PAGINA)

  if (params.q) {
    const q = escapeIlikeOr(params.q)
    query = query.or(`descricao.ilike.%${q}%,codigo.ilike.%${q}%`)
  }
  if (params.familia) query = query.eq('descricao_familia', params.familia)
  if (params.tipo) query = query.eq('tipo_item', params.tipo)

  const { data: produtosRaw } = await query
  const temProxima = (produtosRaw?.length ?? 0) > POR_PAGINA
  const produtos = temProxima ? produtosRaw!.slice(0, POR_PAGINA) : produtosRaw

  // CMC consolidado por produto (registro de maior saldo entre locais/datas)
  const codigos = [...new Set((produtos ?? []).map((p) => p.codigo_produto).filter(Boolean))]
  const { data: posicoes } = codigos.length
    ? await supabase
        .from('posicao_estoques')
        .select('n_cod_prod, n_cmc, n_saldo, data_posicao')
        .eq('loja_id', lojaId)
        .in('n_cod_prod', codigos)
        .order('data_posicao', { ascending: false })
        .order('n_saldo', { ascending: false })
    : { data: [] }
  const cmcMap = new Map<number, number>()
  for (const pos of posicoes ?? []) {
    if (!cmcMap.has(pos.n_cod_prod) && pos.n_cmc) cmcMap.set(pos.n_cod_prod, Number(pos.n_cmc))
  }
  const custoDe = (codProd: number | null): number | null =>
    codProd != null ? cmcMap.get(codProd) ?? null : null

  const exportParams = new URLSearchParams()
  if (params.q) exportParams.set('q', params.q)
  if (params.familia) exportParams.set('familia', params.familia)
  if (params.tipo) exportParams.set('tipo', params.tipo)

  // querystring base para os chips de margem (preserva filtros)
  const chipParams = new URLSearchParams(exportParams.toString())

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produtos"
        icon={Package}
        actions={
          <>
            <FiltrosGaveta
              basePath="/produto"
              campos={[
                { tipo: 'texto', nome: 'q', label: 'Nome ou código' },
                { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes },
                { tipo: 'select', nome: 'tipo', label: 'Tipo', opcoes: PRODUTO_TIPO_ITEM },
              ]}
              defaults={{ q: params.q ?? '', familia: params.familia ?? '', tipo: params.tipo ?? '' }}
            />
            <a href={`/produto/export?${exportParams.toString()}`} className={btnClass('outline')}>
              <Download className="size-4" /> Exportar
            </a>
            {podeSync && <SyncButton endpoint="/api/sync/posicao" label="Atualizar custos" />}
            {podeSync && <SyncButton endpoint="/api/sync/produtos" label="Atualizar agora" />}
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-text-muted">
          <span>Atualizado em {fmtTimestamp(lojaSync?.produto_ultima_atualizacao ?? null)}</span>
          <span>·</span>
          <StatusPill status={lojaSync?.produto_status ?? null} />
        </div>
        {/* Margem alvo para o preço sugerido */}
        <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
          <span className="uppercase tracking-wider">Margem alvo</span>
          {ALVOS.map((a) => {
            const sp = new URLSearchParams(chipParams.toString())
            sp.set('margem', String(a))
            const ativo = a === alvoPct
            return (
              <Link
                key={a}
                href={`/produto?${sp.toString()}`}
                className={`rounded-full px-2.5 py-1 ${ativo ? 'bg-brand text-white' : 'border border-border text-text-muted hover:bg-surface-2'}`}
              >
                {a}%
              </Link>
            )
          })}
        </div>
      </div>

      <Lista
        linhas={produtos ?? []}
        chaveLinha={(p) => p.id}
        colunas={[
          { label: 'Descrição', primaria: true, flexivel: true, render: (p) => p.descricao },
          { label: 'Família', render: (p) => <span className="text-text-muted">{p.descricao_familia || '-'}</span> },
          {
            label: 'Custo',
            alinhar: 'right',
            larguraDesktop: 'w-28',
            render: (p) => {
              const c = custoDe(p.codigo_produto)
              return c != null ? <Money value={c} /> : <span className="text-text-muted">-</span>
            },
          },
          { label: 'Venda', alinhar: 'right', larguraDesktop: 'w-28', render: (p) => <Money value={p.valor_unitario} /> },
          {
            label: 'Margem',
            alinhar: 'right',
            larguraDesktop: 'w-24',
            render: (p) => {
              const m = margem(p.valor_unitario, custoDe(p.codigo_produto))
              if (m == null) return <span className="text-text-muted">-</span>
              return (
                <span className="num font-medium" style={{ color: corMargem(m) }}>
                  {(m * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
                </span>
              )
            },
          },
          {
            label: `Sugerido (${alvoPct}%)`,
            alinhar: 'right',
            larguraDesktop: 'w-32',
            render: (p) => {
              const s = precoSugerido(custoDe(p.codigo_produto), alvo)
              return s != null ? <span className="text-text-muted"><Money value={s} /></span> : <span className="text-text-muted">-</span>
            },
          },
        ]}
        vazio={
          <EmptyState
            icon={Package}
            title="Nenhum produto"
            hint="Sincronize com o Omie ou ajuste a busca."
          />
        }
      />

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/produto" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
