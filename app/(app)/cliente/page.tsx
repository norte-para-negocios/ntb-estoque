import { notFound } from 'next/navigation'
import Link from 'next/link'
import { History, Users } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { BuscaSimples } from '@/components/BuscaSimples'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
import { ClienteForm, ExcluirCliente, TrazerTransportadoras } from '@/components/cliente/ClienteAcoes'
import { papeisDoFiltro, ROTULO_PAPEL, type ClienteInput, type Papel } from '@/lib/clientes/clientes-puro'

// Fase 6 (migration 450): clientes e transportadoras do estoque próprio. Só desenvolvedor por enquanto.
const PER_PAGE = 50
type Row = {
  id: number; papel: Papel; razao_social: string; nome_fantasia: string | null; cnpj_cpf: string | null; inscricao_estadual: string | null
  email: string | null; telefone: string | null; cep: string | null; uf: string | null; cidade: string | null; bairro: string | null
  logradouro: string | null; numero: string | null; complemento: string | null; rntrc: string | null; inativo: boolean; origem: string
}
const valores = (r: Row): ClienteInput => ({
  papel: r.papel, razao_social: r.razao_social, nome_fantasia: r.nome_fantasia ?? '', cnpj_cpf: r.cnpj_cpf ?? '', inscricao_estadual: r.inscricao_estadual ?? '',
  email: r.email ?? '', telefone: r.telefone ?? '', cep: r.cep ?? '', uf: r.uf ?? '', cidade: r.cidade ?? '', bairro: r.bairro ?? '',
  logradouro: r.logradouro ?? '', numero: r.numero ?? '', complemento: r.complemento ?? '', rntrc: r.rntrc ?? '', inativo: r.inativo,
})

export default async function ClientesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; papel?: string }> }) {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Clientes'))) notFound()
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  const papeis = papeisDoFiltro(sp.papel)
  const [podeCriar, podeEditar, podeExcluir] = await Promise.all([
    requirePermissao(lojaId, 'Clientes - Criar'), requirePermissao(lojaId, 'Clientes - Editar'), requirePermissao(lojaId, 'Clientes - Excluir'),
  ])

  let q = createServiceClient().from('clientes')
    .select('id, papel, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, email, telefone, cep, uf, cidade, bairro, logradouro, numero, complemento, rntrc, inativo, origem', { count: 'exact' })
    .eq('loja_id', lojaId).order('razao_social').order('id').range((page - 1) * PER_PAGE, page * PER_PAGE - 1)
  if (papeis) q = q.in('papel', papeis)
  if (sp.q) { const t = escapeIlikeOr(sp.q); q = q.or(`razao_social.ilike.%${t}%,nome_fantasia.ilike.%${t}%,cnpj_cpf.ilike.%${t}%`) }
  const { data, count, error } = await q
  const linhas = (data ?? []) as Row[]
  const total = count ?? 0

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Clientes e transportadoras" icon={Users} description="Quem compra da loja e quem entrega as mercadorias"
          actions={podeCriar ? <><ClienteForm papelInicial={sp.papel === 'transportadora' ? 'transportadora' : 'cliente'} /><TrazerTransportadoras /></> : null} />
      </ListaHeader>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentLinks basePath="/cliente" param="papel" aria-label="Tipo de cadastro"
          opcoes={[{ value: '', label: 'Todos' }, { value: 'cliente', label: 'Clientes' }, { value: 'transportadora', label: 'Transportadoras' }]} />
        <span className="text-[13px] text-text-muted"><span className="num">{total}</span> cadastro(s)</span>
      </div>
      {error && <p className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-text">Não foi possível ler o cadastro agora: {error.message}</p>}
      <BuscaSimples basePath="/cliente" placeholder="Buscar por nome, fantasia ou CNPJ/CPF..." defaultValue={sp.q ?? ''} />
      <Lista<Row>
        linhas={linhas}
        chaveLinha={(r) => r.id}
        colunas={[
          { label: 'Nome', primaria: true, flexivel: true, render: (r) => (
            <div className="min-w-0">
              <Link href={`/cliente/${r.id}`} className="block truncate text-text hover:underline">{r.razao_social}</Link>
              {r.nome_fantasia && <div className="truncate text-[13px] text-text-muted">{r.nome_fantasia}</div>}
              {(r.email || r.telefone) && <div className="truncate text-[12px] text-text-muted">{[r.email, r.telefone].filter(Boolean).join(' · ')}</div>}
            </div>
          ) },
          { label: 'Tipo', render: (r) => <span className="text-[13px] text-text-muted">{ROTULO_PAPEL[r.papel]}</span> },
          { label: 'CNPJ/CPF', render: (r) => <span className="num text-text-muted">{r.cnpj_cpf || '-'}</span> },
          { label: 'Cidade/UF', render: (r) => <span className="text-text-muted">{[r.cidade, r.uf].filter(Boolean).join('/') || '-'}</span> },
          { label: 'Situação', alinhar: 'right', render: (r) => <StatusPill status={r.inativo ? 'Inativo' : 'Ativo'} /> },
        ]}
        acao={(r) => (
          <div className="flex items-center justify-end gap-1">
            <Link href={`/cliente/${r.id}`} className={btnLinhaClass('ghost')} title="Ficha e histórico"><History className="size-4" /> <RotuloAcao>Histórico</RotuloAcao></Link>
            {podeEditar && <ClienteForm existente={{ id: r.id, values: valores(r) }} />}
            {podeExcluir && <ExcluirCliente id={r.id} nome={r.razao_social} />}
          </div>
        )}
        vazio={<EmptyState icon={Users} title="Nenhum cadastro" hint={'Cadastre um cliente ou transportadora, ou use "Trazer das notas" para as transportadoras das notas de entrada.'} />}
      />
      {(page > 1 || page * PER_PAGE < total) && <Paginacao basePath="/cliente" page={page} temProxima={page * PER_PAGE < total} />}
    </div>
  )
}
