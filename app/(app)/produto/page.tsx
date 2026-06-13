import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { SyncButton } from '@/components/SyncButton'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Filtros } from '@/components/ui-kit/Filtros'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { Money } from '@/components/ui-kit/Money'
import { PRODUTO_TIPO_ITEM, labelTipoItem } from '@/lib/constants-omie'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { btnClass } from '@/components/ui-kit/Button'
import { Package, Download } from 'lucide-react'

const POR_PAGINA = 100

function fmtTimestamp(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('pt-BR')
}

export default async function ProdutoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; familia?: string; tipo?: string; page?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const supabase = await createClient()
  const podeSync = await requirePermissao(lojaId, 'Produtos - Sincronizar')

  const { data: lojaSync } = await supabase
    .from('lojas')
    .select('produto_ultima_atualizacao, produto_status')
    .eq('id', lojaId)
    .single()

  // Famílias distintas da loja para o select de filtro
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
    .select('id, codigo, descricao, descricao_familia, tipo_item, unidade, valor_unitario')
    .eq('loja_id', lojaId)
    .order('descricao')
    .range((page - 1) * POR_PAGINA, page * POR_PAGINA) // busca N+1 para detectar próxima

  if (params.q) {
    const q = escapeIlikeOr(params.q)
    query = query.or(`descricao.ilike.%${q}%,codigo.ilike.%${q}%`)
  }
  if (params.familia) query = query.eq('descricao_familia', params.familia)
  if (params.tipo) query = query.eq('tipo_item', params.tipo)

  const { data: produtosRaw } = await query
  const temProxima = (produtosRaw?.length ?? 0) > POR_PAGINA
  const produtos = temProxima ? produtosRaw!.slice(0, POR_PAGINA) : produtosRaw

  const exportParams = new URLSearchParams()
  if (params.q) exportParams.set('q', params.q)
  if (params.familia) exportParams.set('familia', params.familia)
  if (params.tipo) exportParams.set('tipo', params.tipo)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produtos"
        icon={Package}
        actions={
          <>
            <a
              href={`/produto/export?${exportParams.toString()}`}
              className={btnClass('outline')}
            >
              <Download className="size-4" /> Exportar
            </a>
            {podeSync && (
              <SyncButton endpoint="/api/sync/produtos" label="Atualizar agora" />
            )}
          </>
        }
      />

      <div className="flex items-center gap-2 text-[13px] text-text-muted">
        <span>Atualizado em {fmtTimestamp(lojaSync?.produto_ultima_atualizacao ?? null)}</span>
        <span>·</span>
        <StatusPill status={lojaSync?.produto_status ?? null} />
      </div>

      <Filtros
        basePath="/produto"
        campos={[
          { tipo: 'texto', nome: 'q', label: 'Nome ou código' },
          { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes },
          { tipo: 'select', nome: 'tipo', label: 'Tipo', opcoes: PRODUTO_TIPO_ITEM },
        ]}
        defaults={{
          q: params.q ?? '',
          familia: params.familia ?? '',
          tipo: params.tipo ?? '',
        }}
      />

      <Lista
        linhas={produtos ?? []}
        chaveLinha={(p) => p.id}
        colunas={[
          { label: 'Descrição', primaria: true, render: (p) => p.descricao },
          { label: 'Código', larguraDesktop: 'w-28', render: (p) => <span className="num text-text-muted">{p.codigo || '-'}</span> },
          { label: 'Família', render: (p) => <span className="text-text-muted">{p.descricao_familia || '-'}</span> },
          { label: 'Tipo', render: (p) => <span className="text-text-muted">{labelTipoItem(p.tipo_item)}</span> },
          { label: 'Unidade', larguraDesktop: 'w-24', render: (p) => <span className="text-text-muted">{p.unidade || '-'}</span> },
          { label: 'Valor', alinhar: 'right', larguraDesktop: 'w-32', render: (p) => <Money value={p.valor_unitario} /> },
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
