import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao, isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { BuscaSimples } from '@/components/BuscaSimples'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { FamiliaForm } from '@/components/familia/FamiliaForm'
import { ExcluirFamilia } from '@/components/familia/ExcluirFamilia'
import { PuxarFamilias } from '@/components/familia/PuxarFamilias'
import { escapeIlike } from '@/lib/utils-busca'
import { FolderTree } from 'lucide-react'

function fmtTimestamp(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
}

type FamiliaRow = {
  id: number
  codigo_familia: number | null
  codigo: string | null
  nome: string
  inativo: boolean
  origem: string
}

export default async function FamiliaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; situacao?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias'))) notFound()

  const params = await searchParams
  const supabase = await createClient()
  // Puxar do Omie (sync) virou admin-only.
  const podeSync = await isAdmin()
  const podeCriar = await requirePermissao(lojaId, 'Familias - Criar')
  const podeEditar = await requirePermissao(lojaId, 'Familias - Editar')
  const podeExcluir = await requirePermissao(lojaId, 'Familias - Excluir')

  const { data: lojaSync } = await supabase
    .from('lojas')
    .select('familia_ultima_atualizacao, familia_status')
    .eq('id', lojaId)
    .single()

  let query = supabase
    .from('familias')
    .select('id, codigo_familia, codigo, nome, inativo, origem')
    .eq('loja_id', lojaId)
    .order('nome')
    .limit(500)

  if (params.q) query = query.ilike('nome', `%${escapeIlike(params.q)}%`)
  if (params.situacao === 'ativos') query = query.eq('inativo', false)
  else if (params.situacao === 'inativos') query = query.eq('inativo', true)

  const { data: familias } = await query

  return (
    <div className="space-y-4">
      <PageHeader
        title="Famílias"
        icon={FolderTree}
        description="Famílias de produto (cadastro local e leitura do Omie)"
        actions={
          <>
            {podeCriar && <FamiliaForm />}
            {podeSync && <PuxarFamilias />}
          </>
        }
      />

      <div className="flex items-center gap-2 text-[13px] text-text-muted">
        <span>Atualizado em {fmtTimestamp(lojaSync?.familia_ultima_atualizacao ?? null)}</span>
        <span>·</span>
        <StatusPill status={lojaSync?.familia_status ?? null} />
      </div>

      <BuscaSimples basePath="/familia" placeholder="Buscar família..." defaultValue={params.q ?? ''} />

      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { v: '', label: 'Todas' },
          { v: 'ativos', label: 'Ativas' },
          { v: 'inativos', label: 'Inativas' },
        ].map((s) => {
          const ativo = (params.situacao ?? '') === s.v
          const qsp = new URLSearchParams()
          if (params.q) qsp.set('q', params.q)
          if (s.v) qsp.set('situacao', s.v)
          const qs = qsp.toString()
          return (
            <Link
              key={s.v || 'todas'}
              href={`/familia${qs ? `?${qs}` : ''}`}
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

      <Lista<FamiliaRow>
        linhas={(familias ?? []) as FamiliaRow[]}
        chaveLinha={(f) => f.id}
        colunas={[
          { label: 'Nome', primaria: true, flexivel: true, render: (f) => f.nome || '-' },
          {
            label: 'Origem',
            render: (f) => (
              <span className="text-[12px] text-text-muted">
                {f.origem === 'omie' ? 'Omie' : 'Local'}
              </span>
            ),
          },
          {
            label: 'Código Omie',
            render: (f) => <span className="num text-text-muted">{f.codigo_familia ?? '-'}</span>,
          },
          {
            label: 'Situação',
            alinhar: 'right',
            render: (f) => <StatusPill status={f.inativo ? 'Inativa' : 'Ativa'} />,
          },
        ]}
        acao={(f) => (
          <div className="flex items-center justify-end gap-1">
            {podeEditar && (
              <FamiliaForm familia={{ id: f.id, nome: f.nome, codigo: f.codigo, inativo: f.inativo }} />
            )}
            {podeExcluir && <ExcluirFamilia id={f.id} nome={f.nome} />}
          </div>
        )}
        vazio={
          <EmptyState
            icon={FolderTree}
            title="Nenhuma família cadastrada"
            hint='Crie uma família ou clique em "Puxar do Omie".'
          />
        }
      />
    </div>
  )
}
