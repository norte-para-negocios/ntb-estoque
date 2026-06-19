import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { CopyWebhook } from '@/components/loja/CopyWebhook'
import { LojaForm } from '@/components/loja/LojaForm'
import { LojaCard, type LojaRow } from '@/components/loja/LojaCard'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { BuscaSimples } from '@/components/BuscaSimples'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { Store } from 'lucide-react'

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
    // Busca por nome, nome fantasia OU CNPJ
    query = query.or(`nome.ilike.%${t}%,nome_fantasia.ilike.%${t}%,cnpj.ilike.%${t}%`)
  }

  const { data: lojas } = await query

  // Catalogo de permissoes para o convite por codigo (gerado direto da tela da loja).
  const { data: permissoes } = await supabase
    .from('permissoes')
    .select('id, nome')
    .order('id')

  const webhookUrl =
    (process.env.NEXT_PUBLIC_APP_URL || 'https://ntb-estoque.vercel.app') + '/api/webhook'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Lojas"
          icon={Store}
          description="Cadastro de lojas e integracao Omie"
          actions={<LojaForm />}
        />
      </ListaHeader>

      <BuscaSimples basePath="/loja" placeholder="Buscar por nome, nome fantasia ou CNPJ" defaultValue={q} />

      {/* Aviso do webhook do Omie */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 text-sm font-semibold text-text">Webhook do Omie</div>
        <p className="text-[13px] text-text-muted">
          Importante: cadastre o webhook abaixo nos seus aplicativos Omie no endereco{' '}
          <a
            href="https://developer.omie.com.br/my-apps/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand hover:underline"
          >
            developer.omie.com.br/my-apps
          </a>{' '}
          e ative todas as opcoes.
        </p>
        <div className="mt-3">
          <CopyWebhook url={webhookUrl} />
        </div>
      </div>

      <div className="space-y-3">
        {lojas?.length ? (
          lojas.map((loja) => (
            <LojaCard
              key={loja.id}
              loja={loja as LojaRow}
              permissoes={permissoes ?? []}
            />
          ))
        ) : (
          <EmptyState
            icon={Store}
            title="Nenhuma loja cadastrada"
            hint='Clique em "Nova loja" para comecar.'
          />
        )}
      </div>
    </div>
  )
}
