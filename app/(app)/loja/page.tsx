import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { CopyWebhook } from '@/components/loja/CopyWebhook'
import { ForceSyncLoja } from '@/components/loja/ForceSyncLoja'
import { LojaForm } from '@/components/loja/LojaForm'
import { ExcluirLoja } from '@/components/loja/ExcluirLoja'
import { PuxarEmpresa } from '@/components/loja/PuxarEmpresa'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { BuscaSimples } from '@/components/BuscaSimples'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { Store } from 'lucide-react'

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : 'dd/mm/aa hh:mm:ss'
}

// Codigos de regime tributario do Omie (ListarEmpresas).
const REGIME: Record<string, string> = {
  '1': 'Simples Nacional',
  '2': 'Simples Nacional (excesso)',
  '3': 'Regime Normal',
}
function regimeLabel(v: string | null): string | null {
  if (!v) return null
  return REGIME[v] ? `${REGIME[v]} (${v})` : v
}

export default async function LojaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  if (!(await isAdmin())) notFound()

  const params = await searchParams
  const q = (params.q ?? '').trim()

  const supabase = await createClient()
  let query = supabase
    .from('lojas')
    .select('*')
    .order('id')

  if (q) {
    const t = escapeIlikeOr(q)
    query = query.or(`nome.ilike.%${t}%,nome_fantasia.ilike.%${t}%`)
  }

  const { data: lojas } = await query

  const webhookUrl =
    (process.env.NEXT_PUBLIC_APP_URL || 'https://ntb-estoque.vercel.app') + '/api/webhook'

  const sincronizacoes = (loja: Record<string, unknown>) => [
    { label: 'Local de Estoque', data: loja.local_estoque_ultima_atualizacao as string | null, status: loja.local_estoque_status as string | null },
    { label: 'Produto', data: loja.produto_ultima_atualizacao as string | null, status: loja.produto_status as string | null },
    { label: 'Ordem de Produção', data: loja.ordem_producao_ultima_atualizacao as string | null, status: loja.ordem_producao_status as string | null },
    { label: 'Nota Fiscal', data: loja.nota_fiscal_ultima_atualizacao as string | null, status: loja.nota_fiscal_status as string | null },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lojas"
        icon={Store}
        description="Cadastro de lojas e integração Omie"
        actions={<LojaForm />}
      />

      <BuscaSimples basePath="/loja" placeholder="Buscar por nome ou nome fantasia" defaultValue={q} />

      {/* Aviso do webhook do Omie */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 text-sm font-semibold text-text">Webhook do Omie</div>
        <p className="text-[13px] text-text-muted">
          Importante: cadastre o webhook abaixo nos seus aplicativos Omie no endereço{' '}
          <a
            href="https://developer.omie.com.br/my-apps/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand hover:underline"
          >
            developer.omie.com.br/my-apps
          </a>{' '}
          e ative todas as opções.
        </p>
        <div className="mt-3">
          <CopyWebhook url={webhookUrl} />
        </div>
      </div>

      <div className="space-y-3">
        {lojas?.length ? (
          lojas.map((loja) => (
            <div key={loja.id} className="rounded-lg border border-border bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-text">
                    {loja.cnpj ? `${loja.cnpj}: ` : ''}
                    {loja.nome_fantasia || loja.nome}
                  </div>
                  {loja.nome_fantasia && loja.nome && (
                    <div className="truncate text-[12px] text-text-muted">{loja.nome}</div>
                  )}
                </div>
                <StatusPill status={loja.ativo ? 'Ativa' : 'Inativa'} />
              </div>

              <div className="space-y-4 px-4 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[13px] text-text-muted">Atualizações:</span>
                  <ForceSyncLoja lojaId={loja.id} />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {sincronizacoes(loja).map((s) => (
                    <div key={s.label} className="rounded-md border border-border bg-surface-2/40 p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
                        {s.label}
                      </div>
                      <p className="num mt-1 text-[12px] font-medium text-text">{fmt(s.data)}</p>
                      <div className="mt-1.5">
                        <StatusPill status={s.status} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
                  <span className="text-xs text-text-muted">
                    OMIE KEY:{' '}
                    <span className="num text-text">
                      {loja.omie_app_key ? loja.omie_app_key.slice(0, 6) : '-'}
                    </span>
                  </span>
                  <span className="text-xs text-text-muted">
                    OMIE SECRET:{' '}
                    <span className="num text-text">
                      {loja.omie_app_secret ? loja.omie_app_secret.slice(0, 6) : '-'}
                    </span>
                  </span>
                </div>

                {/* Dados da empresa (puxados do Omie via ListarEmpresas) */}
                <div className="border-t border-border pt-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[13px] font-medium text-text">Dados da empresa (Omie)</span>
                    <PuxarEmpresa lojaId={loja.id} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
                    {(
                      [
                        ['Razão social', loja.razao_social as string | null],
                        ['Inscrição estadual', loja.inscricao_estadual as string | null],
                        ['Inscrição municipal', loja.inscricao_municipal as string | null],
                        ['CNAE', loja.cnae as string | null],
                        ['Regime tributário', regimeLabel(loja.regime_tributario as string | null)],
                        ['Contador', loja.sped_nome_contador as string | null],
                        ['E-mail', loja.email as string | null],
                        ['Telefone', loja.telefone1 as string | null],
                        ['CSC produção', loja.csc_producao ? 'definido' : null],
                      ] as [string, string | null][]
                    ).map(([label, valor]) => (
                      <div key={label}>
                        <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
                        <div className="truncate text-text" title={valor ?? undefined}>{valor || '-'}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                  <LojaForm loja={loja} />
                  <ExcluirLoja lojaId={loja.id} nome={loja.nome_fantasia || loja.nome} />
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            icon={Store}
            title="Nenhuma loja cadastrada"
            hint='Clique em "Nova loja" para começar.'
          />
        )}
      </div>
    </div>
  )
}
