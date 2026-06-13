import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { StatCard } from '@/components/ui-kit/StatCard'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Filtros, type CampoFiltro } from '@/components/ui-kit/Filtros'
import { ReprocessarErro } from '@/components/sync/ReprocessarErro'
import type { SyncModel } from '@/lib/actions/sync-status'
import { Activity, AlertTriangle } from 'lucide-react'

// Mapeia o valor da coluna model (sem acento) para o sync reprocessavel.
const MODEL_PARA_SYNC: Record<string, SyncModel> = {
  Produto: 'produto',
  LocalEstoque: 'local',
  NotaFiscal: 'nf',
  OrdemProducao: 'op',
}

// Campos *_status / nome amigavel de cada model de sincronizacao da loja.
const STATUS_LOJA: { campo: string; label: string }[] = [
  { campo: 'produto_status', label: 'Produto' },
  { campo: 'local_estoque_status', label: 'Local' },
  { campo: 'nota_fiscal_status', label: 'NF' },
  { campo: 'ordem_producao_status', label: 'OP' },
]

const LIMITE_ERROS = 100

type LojaStatus = {
  id: number
  nome: string
  nome_fantasia: string | null
  produto_status: string | null
  local_estoque_status: string | null
  nota_fiscal_status: string | null
  ordem_producao_status: string | null
}

function trecho(texto: string | null, max = 140): string {
  if (!texto) return ''
  return texto.length > max ? `${texto.slice(0, max)}...` : texto
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function SyncStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; model?: string }>
}) {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'
  const params = await searchParams

  const dias = Math.max(1, Number(params.dias) || 1)
  const supabase = await createClient()

  // Escopo de lojas visiveis (mesma logica do layout do app).
  let lojasQuery = supabase
    .from('lojas')
    .select(
      'id, nome, nome_fantasia, produto_status, local_estoque_status, nota_fiscal_status, ordem_producao_status'
    )
    .eq('ativo', true)
    .order('nome_fantasia')

  if (!isAdmin) {
    const { data: vinculos } = await supabase
      .from('loja_user')
      .select('loja_id')
      .eq('user_id', profile.id)
    const lojaIds = [
      ...new Set((vinculos ?? []).map((v) => v.loja_id).filter((v): v is number => v != null)),
    ]
    lojasQuery = lojasQuery.in('id', lojaIds.length ? lojaIds : [-1])
  }

  const { data: lojasData } = await lojasQuery
  const lojas = (lojasData ?? []) as LojaStatus[]
  const lojaIdsVisiveis = lojas.map((l) => l.id)
  const nomePorLoja = new Map(lojas.map((l) => [l.id, l.nome_fantasia || l.nome]))

  // Sem lojas visiveis: nada a mostrar.
  const semLojas = lojaIdsVisiveis.length === 0
  const escopo = semLojas ? [-1] : lojaIdsVisiveis

  // Erros nas ultimas 24h (independente do filtro de dias).
  const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: erros24h } = await supabase
    .from('integration_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('error', true)
    .in('loja_id', escopo)
    .gte('created_at', desde24h)

  // Lista de erros: aplica filtro de dias e (opcional) model.
  const desdeFiltro = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
  let errosQuery = supabase
    .from('integration_attempts')
    .select('id, loja_id, model, code, error_message, response, created_at')
    .eq('error', true)
    .in('loja_id', escopo)
    .gte('created_at', desdeFiltro)
    .order('created_at', { ascending: false })
    .limit(LIMITE_ERROS)

  if (params.model) errosQuery = errosQuery.eq('model', params.model)

  const { data: errosData } = await errosQuery
  const erros = errosData ?? []

  // Opcoes de model para o filtro: distintos entre os erros em escopo.
  const { data: modelRows } = await supabase
    .from('integration_attempts')
    .select('model')
    .eq('error', true)
    .in('loja_id', escopo)
    .gte('created_at', desdeFiltro)
    .not('model', 'is', null)
  const modelsDistintos = Array.from(
    new Set((modelRows ?? []).map((r) => r.model as string).filter(Boolean))
  ).sort()

  const campos: CampoFiltro[] = [
    {
      tipo: 'select',
      nome: 'dias',
      label: 'Período',
      opcoes: [
        { value: '1', label: 'Últimas 24h' },
        { value: '7', label: 'Últimos 7 dias' },
        { value: '30', label: 'Últimos 30 dias' },
      ],
    },
    {
      tipo: 'select',
      nome: 'model',
      label: 'Model',
      opcoes: modelsDistintos.map((m) => ({ value: m, label: m })),
    },
  ]

  const defaults: Record<string, string> = {
    dias: String(dias),
    model: params.model ?? '',
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Saúde da integração"
        icon={Activity}
        description="Painel de erros de sincronização com o Omie"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Erros nas últimas 24h"
          value={erros24h ?? 0}
          hint="Tentativas com falha no período"
          icon={AlertTriangle}
          accent={erros24h ? '#ef4444' : '#10b981'}
        />
      </div>

      {/* Status de sincronizacao por loja */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-text">Status de sincronização</h2>
        </div>
        {lojas.length ? (
          <ul className="divide-y divide-border">
            {lojas.map((loja) => (
              <li
                key={loja.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm font-medium text-text">
                  {loja.nome_fantasia || loja.nome}
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {STATUS_LOJA.map((s) => (
                    <span key={s.campo} className="inline-flex items-center gap-1.5">
                      <span className="text-[11px] text-text-muted">{s.label}</span>
                      <StatusPill status={(loja as unknown as Record<string, string | null>)[s.campo]} />
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-6 text-center text-[13px] text-text-muted">
            Nenhuma loja visivel.
          </div>
        )}
      </div>

      <Filtros basePath="/sync-status" campos={campos} defaults={defaults} />

      <Lista
        linhas={erros}
        chaveLinha={(erro) => erro.id}
        colunas={[
          {
            label: 'Model',
            primaria: true,
            larguraDesktop: 'w-32',
            render: (erro) => <span className="font-medium">{erro.model ?? '-'}</span>,
          },
          {
            label: 'Data/hora',
            larguraDesktop: 'w-44',
            render: (erro) => (
              <span className="whitespace-nowrap text-text-muted">
                {formatarData(erro.created_at)}
              </span>
            ),
          },
          {
            label: 'Loja',
            larguraDesktop: 'w-40',
            render: (erro) => nomePorLoja.get(erro.loja_id) ?? `Loja ${erro.loja_id}`,
          },
          {
            label: 'Code',
            larguraDesktop: 'w-20',
            render: (erro) => <span className="text-text-muted">{erro.code ?? '-'}</span>,
          },
          {
            label: 'Erro',
            flexivel: true,
            render: (erro) => (
              <span className="text-text-muted">{trecho(erro.error_message || erro.response)}</span>
            ),
          },
        ]}
        acao={(erro) => {
          const sync = erro.model ? MODEL_PARA_SYNC[erro.model] : undefined
          return sync ? <ReprocessarErro lojaId={erro.loja_id} model={sync} /> : null
        }}
        vazio={
          <EmptyState
            icon={Activity}
            title="Tudo certo"
            hint="Nenhum erro de integração no período."
          />
        }
      />
    </div>
  )
}
