import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { HistoricoAlteracoes } from '@/components/historico/HistoricoAlteracoes'
import { ROTULO_PAPEL, type Papel } from '@/lib/clientes/clientes-puro'

// Fase 6: ficha do cliente/transportadora com o histórico de alterações. Só leitura; editar segue na lista.
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] text-text">{children || '—'}</dd>
    </div>
  )
}

const ORIGEM: Record<string, string> = { local: 'cadastro local', nota: 'nota de entrada', omie: 'Omie' }

export default async function ClienteDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Clientes'))) notFound()
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const { data: c } = await createServiceClient().from('clientes')
    .select('id, papel, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, email, telefone, cep, uf, cidade, bairro, logradouro, numero, complemento, rntrc, inativo, origem')
    .eq('id', Number(id)).eq('loja_id', lojaId).maybeSingle()
  if (!c) notFound()
  const endereco = [c.logradouro, c.numero, c.complemento, c.bairro].filter(Boolean).join(', ')
  const papel = c.papel as Papel
  return (
    <div className="space-y-4">
      <DetailHeader href="/cliente" title={c.razao_social as string}
        breadcrumb={[{ label: 'Clientes e transportadoras', href: '/cliente' }, { label: (c.nome_fantasia as string | null) || (c.razao_social as string) }]}
        meta={<span className="text-[13px] text-text-muted">{ROTULO_PAPEL[papel]} · {c.inativo ? 'Inativo' : 'Ativo'} · origem {ORIGEM[c.origem as string] ?? c.origem}</span>} />
      <div className="rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Nome fantasia">{c.nome_fantasia as string | null}</Campo>
          <Campo label="CNPJ/CPF"><span className="num">{c.cnpj_cpf as string | null}</span></Campo>
          <Campo label="Inscrição estadual"><span className="num">{c.inscricao_estadual as string | null}</span></Campo>
          <Campo label="E-mail">{c.email as string | null}</Campo>
          <Campo label="Telefone"><span className="num">{c.telefone as string | null}</span></Campo>
          <Campo label="Cidade/UF">{[c.cidade, c.uf].filter(Boolean).join('/')}</Campo>
          <Campo label="Endereço">{endereco}</Campo>
          <Campo label="CEP"><span className="num">{c.cep as string | null}</span></Campo>
          {papel !== 'cliente' && <Campo label="RNTRC"><span className="num">{c.rntrc as string | null}</span></Campo>}
        </dl>
      </div>
      <HistoricoAlteracoes lojaId={lojaId} entidade="cliente" ids={[c.id as number]} />
    </div>
  )
}
