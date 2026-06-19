import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao, isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { BuscaSimples } from '@/components/BuscaSimples'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import {
  NovoFornecedor,
  EditarFornecedor,
  ExcluirFornecedor,
  PuxarFornecedores,
} from '@/components/fornecedor/FornecedorAcoes'
import type { ParceiroFormValues } from '@/components/parceiro/ParceiroForm'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { Truck } from 'lucide-react'

const PER_PAGE = 50

function fmtTimestamp(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
}

type ParceiroRow = {
  id: number
  codigo_omie: number | null
  razao_social: string
  nome_fantasia: string | null
  cnpj_cpf: string | null
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

function toValues(p: ParceiroRow): ParceiroFormValues {
  return {
    razao_social: p.razao_social,
    nome_fantasia: p.nome_fantasia ?? '',
    cnpj_cpf: p.cnpj_cpf ?? '',
    pessoa_fisica: p.pessoa_fisica,
    inscricao_estadual: p.inscricao_estadual ?? '',
    email: p.email ?? '',
    telefone: p.telefone ?? '',
    cep: p.cep ?? '',
    uf: p.uf ?? '',
    cidade: p.cidade ?? '',
    bairro: p.bairro ?? '',
    logradouro: p.logradouro ?? '',
    numero: p.numero ?? '',
    inativo: p.inativo,
  }
}

export default async function FornecedorPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores'))) notFound()

  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const supabase = await createClient()
  // Puxar do Omie (sync) virou admin-only.
  const podeSync = await isAdmin()
  const podeCriar = await requirePermissao(lojaId, 'Fornecedores - Criar')
  const podeEditar = await requirePermissao(lojaId, 'Fornecedores - Editar')
  const podeExcluir = await requirePermissao(lojaId, 'Fornecedores - Excluir')

  const { data: lojaSync } = await supabase
    .from('lojas')
    .select('fornecedor_ultima_atualizacao, fornecedor_status')
    .eq('id', lojaId)
    .single()

  let query = supabase
    .from('fornecedores')
    .select(
      'id, codigo_omie, razao_social, nome_fantasia, cnpj_cpf, cidade, uf, inativo, origem, pessoa_fisica, inscricao_estadual, email, telefone, cep, bairro, logradouro, numero',
      { count: 'exact' }
    )
    .eq('loja_id', lojaId)
    .order('razao_social')
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1)

  if (params.q) {
    const t = escapeIlikeOr(params.q)
    query = query.or(`razao_social.ilike.%${t}%,nome_fantasia.ilike.%${t}%,cnpj_cpf.ilike.%${t}%`)
  }

  const { data: fornecedores, count } = await query
  const total = count ?? 0
  const temProxima = page * PER_PAGE < total

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Fornecedores"
          icon={Truck}
          description="Cadastro local de fornecedores (leitura do Omie por tag)"
          actions={
            <>
              {podeCriar && <NovoFornecedor />}
              {podeSync && <PuxarFornecedores />}
            </>
          }
        />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
        <span>{total} fornecedor(es)</span>
        <span>·</span>
        <span>Atualizado em {fmtTimestamp(lojaSync?.fornecedor_ultima_atualizacao ?? null)}</span>
        <span>·</span>
        <StatusPill status={lojaSync?.fornecedor_status ?? null} />
      </div>

      <BuscaSimples
        basePath="/fornecedor"
        placeholder="Buscar por razão social, fantasia ou CNPJ/CPF..."
        defaultValue={params.q ?? ''}
      />

      <Lista<ParceiroRow>
        linhas={(fornecedores ?? []) as ParceiroRow[]}
        chaveLinha={(p) => p.id}
        colunas={[
          {
            label: 'Razão social',
            primaria: true,
            flexivel: true,
            render: (p) => (
              <div className="min-w-0">
                <div className="truncate text-text">{p.razao_social}</div>
                {p.nome_fantasia && (
                  <div className="truncate text-[12px] text-text-muted">{p.nome_fantasia}</div>
                )}
              </div>
            ),
          },
          { label: 'CNPJ/CPF', render: (p) => <span className="num text-text-muted">{p.cnpj_cpf || '-'}</span> },
          {
            label: 'Cidade/UF',
            render: (p) => (
              <span className="text-text-muted">
                {[p.cidade, p.uf].filter(Boolean).join('/') || '-'}
              </span>
            ),
          },
          {
            label: 'Origem',
            render: (p) => (
              <span className="text-[12px] text-text-muted">{p.origem === 'omie' ? 'Omie' : 'Local'}</span>
            ),
          },
          {
            label: 'Situação',
            alinhar: 'right',
            render: (p) => <StatusPill status={p.inativo ? 'Inativo' : 'Ativo'} />,
          },
        ]}
        acao={(p) => (
          <div className="flex items-center justify-end gap-1">
            {podeEditar && <EditarFornecedor existente={{ id: p.id, values: toValues(p) }} />}
            {podeExcluir && <ExcluirFornecedor id={p.id} nome={p.razao_social} />}
          </div>
        )}
        vazio={
          <EmptyState
            icon={Truck}
            title="Nenhum fornecedor"
            hint='Cadastre um fornecedor ou clique em "Puxar do Omie".'
          />
        }
      />

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/fornecedor" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
