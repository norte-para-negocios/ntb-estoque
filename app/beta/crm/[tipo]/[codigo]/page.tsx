import { notFound } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import {
  Mail, Phone, MapPin, FileText, Building2, User, TrendingDown, TrendingUp, AlertTriangle, CheckCircle2, Receipt,
} from 'lucide-react'

type Params = Promise<{ tipo: string; codigo: string }>

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function diasAte(venc: string | null): number | null {
  if (!venc) return null
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const [y, m, day] = venc.split('-')
  const v = new Date(Number(y), Number(m) - 1, Number(day)); v.setHours(0, 0, 0, 0)
  return Math.round((v.getTime() - hoje.getTime()) / 86400000)
}

export default async function ParceiroDetalhe({ params }: { params: Params }) {
  const [profile, p] = await Promise.all([getProfile(), params])
  const lojaId = profile.current_loja_id
  const tipo = p.tipo === 'fornecedor' ? 'fornecedor' : 'cliente'
  const codigo = Number(p.codigo)
  if (!lojaId || !Number.isFinite(codigo)) notFound()

  const tabela = tipo === 'fornecedor' ? 'fornecedores' : 'clientes'
  const sb = await createClient()

  const { data: parceiro } = await sb
    .from(tabela)
    .select('codigo_omie,razao_social,nome_fantasia,cnpj_cpf,pessoa_fisica,email,telefone,cep,uf,cidade,bairro,logradouro,numero,inativo,inscricao_estadual')
    .eq('loja_id', lojaId)
    .eq('codigo_omie', codigo)
    .maybeSingle()

  if (!parceiro) notFound()

  const endereco = [
    [parceiro.logradouro, parceiro.numero].filter(Boolean).join(', '),
    parceiro.bairro,
    [parceiro.cidade, parceiro.uf].filter(Boolean).join('/'),
    parceiro.cep,
  ].filter(Boolean).join(' · ')

  const ehForn = tipo === 'fornecedor'

  // Movimento financeiro do parceiro (cards via RPC agregada; lista limitada a 500)
  const tabelaConta = ehForn ? 'contas_pagar' : 'contas_receber'
  const [contasRes, resumoRes, nfRes, nfTotalRes] = await Promise.all([
    sb.from(tabelaConta)
      .select('codigo_lancamento_omie,data_vencimento,valor_documento,status_titulo,numero_documento')
      .eq('loja_id', lojaId)
      .eq('codigo_cliente_fornecedor', codigo)
      .order('data_vencimento', { ascending: true })
      .limit(500),
    sb.rpc('crm_resumo_contas', { p_loja_id: lojaId, p_codigo: codigo, p_tipo: tipo }),
    ehForn
      ? sb.from('notas_fiscais')
          .select('id,c_numero_nfe,d_emissao_nfe,n_valor_nfe,c_natureza_operacao')
          .eq('loja_id', lojaId).eq('n_id_fornecedor', codigo).is('deleted_at', null)
          .order('d_emissao_nfe', { ascending: false }).limit(20)
      : Promise.resolve({ data: null }),
    ehForn
      ? sb.rpc('crm_fornecedor_nf', { p_loja_id: lojaId, p_codigo: codigo })
      : Promise.resolve({ data: null }),
  ])

  const contas = contasRes.data ?? []
  const resumo = (resumoRes.data?.[0] ?? { total: 0, atrasado: 0, qtd: 0 }) as { total: number; atrasado: number; qtd: number }
  const totalAberto = Number(resumo.total)
  const totalAtrasado = Number(resumo.atrasado)
  const qtdTitulos = Number(resumo.qtd)
  const truncado = qtdTitulos > contas.length

  const nfs = (nfRes.data ?? []) as { id: number; c_numero_nfe: string | null; d_emissao_nfe: string | null; n_valor_nfe: number | null; c_natureza_operacao: string | null }[]
  const nfTotal = (nfTotalRes.data?.[0] ?? { total: 0, qtd: 0 }) as { total: number; qtd: number }
  const totalComprado = Number(nfTotal.total)
  const qtdNf = Number(nfTotal.qtd)

  return (
    <div className="space-y-6">
      <DetailHeader
        href={`/beta/crm?tipo=${tipo}`}
        title={parceiro.razao_social}
        breadcrumb={[{ label: 'CRM', href: '/beta/crm' }, { label: ehForn ? 'Fornecedores' : 'Clientes', href: `/beta/crm?tipo=${tipo}` }, { label: parceiro.razao_social }]}
        meta={
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-muted">
            <span className="inline-flex items-center gap-1">
              {parceiro.pessoa_fisica ? <User className="size-3" /> : <Building2 className="size-3" />}
              {parceiro.cnpj_cpf || 'sem CNPJ/CPF'}
            </span>
            {parceiro.inativo && <span className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[10px]">Inativo</span>}
          </div>
        }
      />

      {/* Cards financeiros */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MoneyCard
          label={ehForn ? 'A pagar (aberto)' : 'A receber (aberto)'}
          value={totalAberto}
          icon={ehForn ? TrendingDown : TrendingUp}
          cor={ehForn ? 'var(--err)' : 'var(--ok)'}
        />
        <MoneyCard label="Em atraso" value={totalAtrasado} icon={AlertTriangle} cor="var(--warn)" />
        {ehForn
          ? <MoneyCard label={`Total comprado (${qtdNf} NFs)`} value={totalComprado} icon={Receipt} cor="var(--brand)" />
          : <CountCard label="Titulos em aberto" value={qtdTitulos} icon={FileText} />}
      </div>

      {/* Contato */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InfoLinha icon={Mail} label="E-mail" valor={parceiro.email} />
        <InfoLinha icon={Phone} label="Telefone" valor={parceiro.telefone} />
        <InfoLinha icon={MapPin} label="Endereco" valor={endereco || null} />
      </div>

      {/* NFs de entrada (fornecedor) */}
      {ehForn && (
        <section>
          <h3 className="mb-3 text-[13px] font-semibold text-text">Ultimas notas de entrada</h3>
          {nfs.length === 0 ? (
            <EmptyState icon={Receipt} title="Sem notas" hint="Nenhuma NF de entrada registrada deste fornecedor." />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="px-3 py-2.5 text-left font-semibold text-text-muted">NF</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Emissao</th>
                    <th className="hidden px-3 py-2.5 text-left font-semibold text-text-muted md:table-cell">Natureza</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {nfs.map((nf) => (
                    <tr key={nf.id} className="hover:bg-surface-2/50">
                      <td className="px-3 py-2.5 font-medium text-text num">{nf.c_numero_nfe || '-'}</td>
                      <td className="px-3 py-2.5 text-text-muted">{fmtData(nf.d_emissao_nfe)}</td>
                      <td className="hidden px-3 py-2.5 text-text-muted md:table-cell truncate max-w-[200px]">{nf.c_natureza_operacao || '-'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-text num"><Money value={Number(nf.n_valor_nfe ?? 0)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Contas em aberto */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-text">{ehForn ? 'Contas a pagar em aberto' : 'Contas a receber em aberto'}</h3>
          {truncado && <span className="text-[11px] text-text-muted">mostrando 500 de {qtdTitulos}</span>}
        </div>
        {contas.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nada em aberto" hint={ehForn ? 'Sem contas a pagar para este fornecedor.' : 'Sem contas a receber para este cliente.'} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Documento</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Vencimento</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Valor</th>
                  <th className="hidden px-3 py-2.5 text-right font-semibold text-text-muted sm:table-cell">Dias</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {contas.map((c) => {
                  const dias = diasAte(c.data_vencimento)
                  const overdue = (dias ?? 0) < 0 || c.status_titulo === 'ATRASADO'
                  return (
                    <tr key={c.codigo_lancamento_omie} className="hover:bg-surface-2/50">
                      <td className="px-3 py-2.5 font-medium text-text">{c.numero_documento || '-'}</td>
                      <td className="px-3 py-2.5 text-text-muted">{fmtData(c.data_vencimento)}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold num ${overdue ? 'text-err' : 'text-text'}`}><Money value={Number(c.valor_documento)} /></td>
                      <td className={`hidden px-3 py-2.5 text-right sm:table-cell num ${overdue ? 'text-err font-semibold' : 'text-text-muted'}`}>
                        {dias !== null ? (dias < 0 ? `${Math.abs(dias)}d atras` : dias === 0 ? 'Hoje' : `${dias}d`) : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function MoneyCard({ label, value, icon: Icon, cor }: { label: string; value: number; icon: React.ElementType; cor: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-4">
      <div className="absolute inset-x-0 top-0 h-[2px] opacity-60" style={{ background: cor }} />
      <span className="flex size-8 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${cor} 12%, transparent)` }}>
        <Icon className="size-4" style={{ color: cor }} strokeWidth={2} />
      </span>
      <div className="mt-3 text-[1.4rem] font-semibold leading-none text-text num"><Money value={value} /></div>
      <div className="mt-1.5 text-[11px] text-text-muted">{label}</div>
    </div>
  )
}

function CountCard({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-4">
      <div className="absolute inset-x-0 top-0 h-[2px] opacity-60" style={{ background: 'var(--text-muted)' }} />
      <span className="flex size-8 items-center justify-center rounded-md bg-surface-2">
        <Icon className="size-4 text-text-muted" strokeWidth={2} />
      </span>
      <div className="mt-3 text-[1.4rem] font-semibold leading-none text-text num">{value}</div>
      <div className="mt-1.5 text-[11px] text-text-muted">{label}</div>
    </div>
  )
}

function InfoLinha({ icon: Icon, label, valor }: { icon: React.ElementType; label: string; valor: string | null }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-text-muted" />
      <div className="min-w-0">
        <div className="text-[11px] text-text-muted">{label}</div>
        <div className="truncate text-[13px] text-text">{valor || '-'}</div>
      </div>
    </div>
  )
}
