import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { HistoricoAlteracoes } from '@/components/historico/HistoricoAlteracoes'

// Fase G [O3]: ficha do fornecedor com o histórico de alterações (quem mudou o quê). Só leitura; editar segue na lista.
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] text-text">{children || '—'}</dd>
    </div>
  )
}

export default async function FornecedorDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores'))) notFound()
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const supabase = await createClient()
  const { data: f } = await supabase
    .from('fornecedores')
    .select('id, codigo_omie, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, email, telefone, cep, uf, cidade, bairro, logradouro, numero, complemento, inativo, origem')
    .eq('id', Number(id))
    .eq('loja_id', lojaId)
    .maybeSingle()
  if (!f) notFound()
  const endereco = [f.logradouro, f.numero, f.complemento, f.bairro].filter(Boolean).join(', ')

  return (
    <div className="space-y-4">
      <DetailHeader
        href="/fornecedor"
        title={f.razao_social as string}
        breadcrumb={[{ label: 'Fornecedores', href: '/fornecedor' }, { label: (f.nome_fantasia as string | null) || (f.razao_social as string) }]}
        meta={<span className="text-[13px] text-text-muted">{f.inativo ? 'Inativo' : 'Ativo'} · origem {f.origem === 'omie' ? 'Omie' : f.origem === 'sefaz' ? 'nota da SEFAZ' : f.origem === 'planilha' ? 'planilha' : 'cadastro local'}</span>}
      />
      <div className="rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Nome fantasia">{f.nome_fantasia as string | null}</Campo>
          <Campo label="CNPJ/CPF"><span className="num">{f.cnpj_cpf as string | null}</span></Campo>
          <Campo label="Inscrição estadual"><span className="num">{f.inscricao_estadual as string | null}</span></Campo>
          <Campo label="E-mail">{f.email as string | null}</Campo>
          <Campo label="Telefone"><span className="num">{f.telefone as string | null}</span></Campo>
          <Campo label="Cidade/UF">{[f.cidade, f.uf].filter(Boolean).join('/')}</Campo>
          <Campo label="Endereço">{endereco}</Campo>
          <Campo label="CEP"><span className="num">{f.cep as string | null}</span></Campo>
          {f.codigo_omie != null && <Campo label="Código no Omie"><span className="num">{String(f.codigo_omie)}</span></Campo>}
        </dl>
      </div>
      <HistoricoAlteracoes lojaId={lojaId} entidade="fornecedor" ids={[f.id as number]} />
    </div>
  )
}
