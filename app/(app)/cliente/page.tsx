import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { BuscaSimples } from '@/components/BuscaSimples'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import {
  NovoCliente,
  EditarCliente,
  ExcluirCliente,
  PuxarClientes,
} from '@/components/cliente/ClienteAcoes'
import type { ParceiroFormValues } from '@/components/parceiro/ParceiroForm'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { Contact } from 'lucide-react'

const PER_PAGE = 50

function fmtTimestamp(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
}

type ClienteRow = {
  id: number
  codigo_omie: number | null
  razao_social: string
  nome_fantasia: string | null
  cnpj_cpf: string | null
  cest: string | null
  cidade: string | null
  uf: string | null
  inativo: boolean
  origem: string
  pessoa_fisica: boolean
  inscricao_estadual: string | null
  email: string | null
  telefone: string | null
  cep: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
}

function toValues(c: ClienteRow): ParceiroFormValues {
  return {
    razao_social: c.razao_social,
    nome_fantasia: c.nome_fantasia ?? '',
    cnpj_cpf: c.cnpj_cpf ?? '',
    pessoa_fisica: c.pessoa_fisica,
    inscricao_estadual: c.inscricao_estadual ?? '',
    cest: c.cest ?? '',
    email: c.email ?? '',
    telefone: c.telefone ?? '',
    cep: c.cep ?? '',
    uf: c.uf ?? '',
    cidade: c.cidade ?? '',
    bairro: c.bairro ?? '',
    logradouro: c.logradouro ?? '',
    numero: c.numero ?? '',
    inativo: c.inativo,
  }
}

export default async function ClientePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Clientes'))) notFound()

  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const supabase = await createClient()
  const podeSync = await requirePermissao(lojaId, 'Clientes - Sincronizar')

  const { data: lojaSync } = await supabase
    .from('lojas')
    .select('cliente_ultima_atualizacao, cliente_status')
    .eq('id', lojaId)
    .single()

  let query = supabase
    .from('clientes')
    .select(
      'id, codigo_omie, razao_social, nome_fantasia, cnpj_cpf, cest, cidade, uf, inativo, origem, pessoa_fisica, inscricao_estadual, email, telefone, cep, bairro, logradouro, numero',
      { count: 'exact' }
    )
    .eq('loja_id', lojaId)
    .order('razao_social')
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1)

  if (params.q) {
    const t = escapeIlikeOr(params.q)
    query = query.or(`razao_social.ilike.%${t}%,nome_fantasia.ilike.%${t}%,cnpj_cpf.ilike.%${t}%`)
  }

  const { data: clientes, count } = await query
  const total = count ?? 0
  const temProxima = page * PER_PAGE < total

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clientes"
        icon={Contact}
        description="Cadastro local de clientes, com CEST (leitura do Omie por tag)"
        actions={
          <>
            <NovoCliente />
            {podeSync && <PuxarClientes />}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
        <span>{total} cliente(s)</span>
        <span>·</span>
        <span>Atualizado em {fmtTimestamp(lojaSync?.cliente_ultima_atualizacao ?? null)}</span>
        <span>·</span>
        <StatusPill status={lojaSync?.cliente_status ?? null} />
      </div>

      <BuscaSimples
        basePath="/cliente"
        placeholder="Buscar por razão social, fantasia ou CNPJ/CPF..."
        defaultValue={params.q ?? ''}
      />

      <Lista<ClienteRow>
        linhas={(clientes ?? []) as ClienteRow[]}
        chaveLinha={(c) => c.id}
        colunas={[
          {
            label: 'Razão social',
            primaria: true,
            flexivel: true,
            render: (c) => (
              <div className="min-w-0">
                <div className="truncate text-text">{c.razao_social}</div>
                {c.nome_fantasia && (
                  <div className="truncate text-[12px] text-text-muted">{c.nome_fantasia}</div>
                )}
              </div>
            ),
          },
          { label: 'CNPJ/CPF', render: (c) => <span className="num text-text-muted">{c.cnpj_cpf || '-'}</span> },
          { label: 'CEST', render: (c) => <span className="num text-text-muted">{c.cest || '-'}</span> },
          {
            label: 'Cidade/UF',
            render: (c) => (
              <span className="text-text-muted">{[c.cidade, c.uf].filter(Boolean).join('/') || '-'}</span>
            ),
          },
          {
            label: 'Situação',
            alinhar: 'right',
            render: (c) => <StatusPill status={c.inativo ? 'Inativo' : 'Ativo'} />,
          },
        ]}
        acao={(c) => (
          <div className="flex items-center justify-end gap-1">
            <EditarCliente existente={{ id: c.id, values: toValues(c) }} />
            <ExcluirCliente id={c.id} nome={c.razao_social} />
          </div>
        )}
        vazio={
          <EmptyState
            icon={Contact}
            title="Nenhum cliente"
            hint='Cadastre um cliente ou clique em "Puxar do Omie".'
          />
        }
      />

      {(page > 1 || temProxima) && <Paginacao basePath="/cliente" page={page} temProxima={temProxima} />}
    </div>
  )
}
