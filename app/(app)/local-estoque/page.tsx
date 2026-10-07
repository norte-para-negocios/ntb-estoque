import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao, isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SyncButton } from '@/components/SyncButton'
import { NovoLocalEstoque } from '@/components/local-estoque/NovoLocalEstoque'
import { ExcluirLocalEstoque } from '@/components/local-estoque/ExcluirLocalEstoque'
import { EditarLocalEstoque } from '@/components/local-estoque/EditarLocalEstoque'
import { BuscaSimples } from '@/components/BuscaSimples'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { escapeIlike } from '@/lib/utils-busca'
import { Warehouse } from 'lucide-react'
import { modoDaLoja } from '@/lib/estoque/ledger'

function fmtTimestamp(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
}

type LinhaLocal = {
  id: number
  codigo_local_estoque: number
  codigo: string | null
  descricao: string | null
  inativo: string | null
  tipo: string | null
  padrao: string | null
  disp_venda: string | null
  disp_consumo_op: string | null
  disp_ordem_producao: string | null
  disp_remessa: string | null
}

const COLUNAS_SORT = ['descricao', 'codigo_local_estoque', 'codigo', 'inativo'] as const
type ColSort = (typeof COLUNAS_SORT)[number]

export default async function LocalEstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; situacao?: string; ord?: string; dir?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Locais de Estoque'))) notFound()

  const params = await searchParams
  const ordRaw = params.ord ?? 'descricao'
  const ord: ColSort = (COLUNAS_SORT as readonly string[]).includes(ordRaw) ? (ordRaw as ColSort) : 'descricao'
  const dir = params.dir === 'desc' ? 'desc' : 'asc' // default hoje é descrição A-Z (asc)

  const supabase = await createClient()
  // Loja com estoque proprio: locais criados aqui mesmo (sem sincronizar com Omie), com os mesmos campos.
  const proprio = (await modoDaLoja(lojaId)) === 'proprio'
  // Sync (Sincronizar com Omie) virou admin-only.
  const podeSync = await isAdmin()
  const podeCriar = await requirePermissao(lojaId, 'Locais de Estoque - Criar')
  const podeEditar = await requirePermissao(lojaId, 'Locais de Estoque - Editar')
  const podeExcluir = await requirePermissao(lojaId, 'Locais de Estoque - Excluir')

  const { data: lojaSync } = await supabase
    .from('lojas')
    .select('local_estoque_ultima_atualizacao, local_estoque_status')
    .eq('id', lojaId)
    .single()

  let query = supabase
    .from('local_estoques')
    .select('id, codigo_local_estoque, codigo, descricao, inativo, tipo, padrao, disp_venda, disp_consumo_op, disp_ordem_producao, disp_remessa')
    .eq('loja_id', lojaId)
    .order(ord, { ascending: dir === 'asc' })
    .limit(200)

  if (params.q) query = query.ilike('descricao', `%${escapeIlike(params.q)}%`)
  // Situacao: ativos (inativo != S) / inativos (inativo = S) / todos (default).
  if (params.situacao === 'ativos') query = query.neq('inativo', 'S')
  else if (params.situacao === 'inativos') query = query.eq('inativo', 'S')

  const { data: locais } = await query

  function buildSortHref(key: string, newDir: 'asc' | 'desc'): string {
    const p = new URLSearchParams()
    if (params.q) p.set('q', params.q)
    if (params.situacao) p.set('situacao', params.situacao)
    p.set('ord', key)
    p.set('dir', newDir)
    return `/local-estoque?${p.toString()}`
  }

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Locais de Estoque"
          icon={Warehouse}
          description={proprio ? 'Onde o estoque da loja fica guardado' : 'Locais sincronizados do Omie'}
          actions={
            <>
              {podeCriar && <NovoLocalEstoque proprio={proprio} />}
              {podeSync && !proprio && <SyncButton endpoint="/api/sync/locais" label="Sincronizar com Omie" />}
            </>
          }
        />
      </ListaHeader>

      {!proprio && (
        <div className="flex items-center gap-2 text-[13px] text-text-muted">
          <span>Atualizado em {fmtTimestamp(lojaSync?.local_estoque_ultima_atualizacao ?? null)}</span>
          <span>·</span>
          <StatusPill status={lojaSync?.local_estoque_status ?? null} />
        </div>
      )}

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
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                ativo
                  ? 'bg-brand-fill text-white'
                  : 'bg-surface-2 text-text-muted hover:text-text'
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
        sortAtual={ord}
        dirAtual={dir}
        sortHref={buildSortHref}
        colunas={[
          { label: 'Descrição', primaria: true, sort: 'descricao', render: (l) => l.descricao || '-' },
          {
            label: 'Código local',
            sort: 'codigo_local_estoque',
            render: (l) => <span className="num text-text-muted">{l.codigo_local_estoque || '-'}</span>,
          },
          {
            label: 'Código',
            larguraDesktop: 'w-28',
            sort: 'codigo',
            render: (l) => <span className="num text-text-muted">{l.codigo || '-'}</span>,
          },
          ...(proprio
            ? [
                {
                  label: 'Tipo',
                  render: (l: LinhaLocal) => <span className="text-text-muted">{l.tipo || '-'}</span>,
                },
                {
                  label: 'Padrão',
                  larguraDesktop: 'w-24',
                  render: (l: LinhaLocal) => (l.padrao === 'S' ? <StatusPill status="Padrão" /> : <span className="text-text-muted">-</span>),
                },
              ]
            : []),
          {
            label: 'Situação',
            alinhar: 'right',
            larguraDesktop: 'w-32',
            sort: 'inativo',
            render: (l) => <StatusPill status={l.inativo === 'S' ? 'Inativo' : 'Ativo'} />,
          },
        ]}
        acao={(l) =>
          podeEditar || podeExcluir ? (
            <div className="flex items-center justify-end gap-1">
              {podeEditar && (
                <EditarLocalEstoque
                  codigoLocalEstoque={l.codigo_local_estoque}
                  descricaoAtual={l.descricao || ''}
                  codigoAtual={l.codigo || ''}
                  proprio={proprio}
                  extrasAtuais={
                    proprio
                      ? {
                          tipo: l.tipo ?? '',
                          padrao: l.padrao === 'S',
                          inativo: l.inativo === 'S',
                          dispVenda: l.disp_venda !== 'N',
                          dispConsumoOp: l.disp_consumo_op !== 'N',
                          dispOrdemProducao: l.disp_ordem_producao !== 'N',
                          dispRemessa: l.disp_remessa !== 'N',
                        }
                      : undefined
                  }
                />
              )}
              {podeExcluir && <ExcluirLocalEstoque id={l.id} descricao={l.descricao || ''} proprio={proprio} />}
            </div>
          ) : null
        }
        vazio={
          <EmptyState
            icon={Warehouse}
            title="Nenhum local de estoque"
            hint={proprio ? 'Crie o primeiro local da loja.' : 'Sincronize com o Omie para ver os locais.'}
          />
        }
      />
    </div>
  )
}
