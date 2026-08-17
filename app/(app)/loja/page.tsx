import { createClient, createServiceClient } from '@/lib/supabase/server'
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
  const supabaseService = createServiceClient()
  let query = supabaseService
    .from('lojas')
    .select('*')
    .order('id')

  if (q) {
    const t = escapeIlikeOr(q)
    // Busca por nome, nome fantasia OU CNPJ
    query = query.or(`nome.ilike.%${t}%,nome_fantasia.ilike.%${t}%,cnpj.ilike.%${t}%`)
  }

  const { data: lojasRaw } = await query

  // integracao_api_key nunca pode chegar no client component (write-only,
  // ver Fase 0 da contenção de RLS no AGENTS.md) -- computa o boolean aqui,
  // no server component, e descarta o valor bruto antes de montar o objeto
  // que desce pra LojaCard.
  const lojas = lojasRaw?.map(({ integracao_api_key, ...resto }) => ({
    ...resto,
    integracao_ntb_vendas_configurada: !!integracao_api_key,
  }))

  // Catalogo de permissoes para o convite por codigo (gerado direto da tela da loja).
  const { data: permissoes } = await supabase
    .from('permissoes')
    .select('id, nome')
    .order('id')

  // Locais de estoque de cada loja, pro seletor de "qual local e' a Cozinha /
  // o Bar" (mapeamento_local_estoque_ntb_vendas.sql, 2026-08-16) -- uma
  // query so' pra todas as lojas, agrupada em memoria, em vez de N+1.
  const lojaIds = (lojas ?? []).map((l) => l.id)
  const { data: locaisRaw } = lojaIds.length
    ? await supabaseService
        .from('local_estoques')
        .select('loja_id, codigo_local_estoque, descricao')
        .in('loja_id', lojaIds)
        .order('descricao')
    : { data: [] }
  const locaisPorLoja = new Map<number, { codigo_local_estoque: number; descricao: string }[]>()
  for (const l of locaisRaw ?? []) {
    if (!locaisPorLoja.has(l.loja_id)) locaisPorLoja.set(l.loja_id, [])
    locaisPorLoja.get(l.loja_id)!.push({ codigo_local_estoque: l.codigo_local_estoque, descricao: l.descricao })
  }

  // O app de verdade (o que o usuário usa no dia a dia) roda no Contabo, não
  // na Vercel -- NEXT_PUBLIC_APP_URL nunca foi configurado lá, então esse
  // fallback (usado quando a env var não está definida) tem que apontar pro
  // domínio real, senão essa tela ensina a cadastrar o webhook no lugar errado.
  const webhookUrl =
    (process.env.NEXT_PUBLIC_APP_URL || 'https://app-estoque.norteparanegocios.com.br') + '/api/webhook'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Lojas"
          icon={Store}
          description="Cadastro de lojas e integração Omie"
          actions={<LojaForm />}
        />
      </ListaHeader>

      <BuscaSimples basePath="/loja" placeholder="Buscar por nome, nome fantasia ou CNPJ" defaultValue={q} />

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
            <LojaCard
              key={loja.id}
              loja={loja as LojaRow}
              permissoes={permissoes ?? []}
              locaisEstoque={locaisPorLoja.get(loja.id) ?? []}
            />
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
