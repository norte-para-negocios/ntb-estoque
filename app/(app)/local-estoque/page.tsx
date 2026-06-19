import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao, isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SyncButton } from '@/components/SyncButton'
import { NovoLocalEstoque } from '@/components/local-estoque/NovoLocalEstoque'
import { BuscaSimples } from '@/components/BuscaSimples'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { escapeIlike } from '@/lib/utils-busca'
import { Warehouse } from 'lucide-react'

function fmtTimestamp(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
}

export default async function LocalEstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; situacao?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Locais de Estoque'))) notFound()

  const params = await searchParams
  const supabase = await createClient()
  // Sync (Sincronizar com Omie) virou admin-only.
  const podeSync = await isAdmin()
  const podeCriar = await requirePermissao(lojaId, 'Locais de Estoque - Criar')

  const { data: lojaSync } = await supabase
    .from('lojas')
    .select('local_estoque_ultima_atualizacao, local_estoque_status')
    .eq('id', lojaId)
    .single()

  let query = supabase
    .from('local_estoques')
    .select('id, codigo_local_estoque, codigo, descricao, inativo')
    .eq('loja_id', lojaId)
    .order('descricao')
    .limit(200)

  if (params.q) query = query.ilike('descricao', `%${escapeIlike(params.q)}%`)
  // Situacao: ativos (inativo != S) / inativos (inativo = S) / todos (default).
  if (params.situacao === 'ativos') query = query.neq('inativo', 'S')
  else if (params.situacao === 'inativos') query = query.eq('inativo', 'S')

  const { data: locais } = await query

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Locais de Estoque"
          icon={Warehouse}
          description="Locais sincronizados do Omie"
          actions={
            <>
              {podeCriar && <NovoLocalEstoque />}
              {podeSync && <SyncButton endpoint="/api/sync/locais" label="Sincronizar com Omie" />}
            </>
          }
        />
      </ListaHeader>

      <div className="flex items-center gap-2 text-[13px] text-text-muted">
        <span>Atualizado em {fmtTimestamp(lojaSync?.local_estoque_ultima_atualizacao ?? null)}</span>
        <span>·</span>
        <StatusPill status={lojaSync?.local_estoque_status ?? null} />
      </div>

      <BuscaSimples
        basePath="/local-estoque"
        placeholder="Buscar local..."
        defaultValue={params.q ?? ''}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { v: '', label: 'Todos' },
          { v: 'ativos', label: 'Ativos' },
          { v: 'inativos', label: 'Inativos' },
        ].map((s) => {
          const ativo = (params.situacao ?? '') === s.v
          const qsp = new URLSearchParams()
          if (params.q) qsp.set('q', params.q)
          if (s.v) qsp.set('situacao', s.v)
          const qs = qsp.toString()
          return (
            <Link
              key={s.v || 'todos'}
              href={`/local-estoque${qs ? `?${qs}` : ''}`}
              className={`rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
                ativo
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-surface text-text-muted hover:bg-surface-2/60'
              }`}
            >
              {s.label}
            </Link>
          )
        })}
      </div>

      <Lista
        linhas={locais ?? []}
        chaveLinha={(l) => l.id}
        colunas={[
          { label: 'Descrição', primaria: true, render: (l) => l.descricao || '-' },
          { label: 'Código local', render: (l) => <span className="num text-text-muted">{l.codigo_local_estoque || '-'}</span> },
          { label: 'Código', larguraDesktop: 'w-28', render: (l) => <span className="num text-text-muted">{l.codigo || '-'}</span> },
          {
            label: 'Situação',
            alinhar: 'right',
            larguraDesktop: 'w-32',
            render: (l) => <StatusPill status={l.inativo === 'S' ? 'Inativo' : 'Ativo'} />,
          },
        ]}
        vazio={
          <EmptyState
            icon={Warehouse}
            title="Nenhum local de estoque"
            hint="Sincronize com o Omie para ver os locais."
          />
        }
      />
    </div>
  )
}
