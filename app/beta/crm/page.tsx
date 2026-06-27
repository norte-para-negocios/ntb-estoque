import Link from 'next/link'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { Users, Truck, Search, ChevronRight, Package } from 'lucide-react'

const PER_PAGE = 50

type SearchParams = Promise<{ tipo?: string; q?: string; page?: string }>

type ParceiroRow = {
  codigo_omie: number | null
  razao_social: string
  nome_fantasia: string | null
  cnpj_cpf: string | null
  cidade: string | null
  uf: string | null
  telefone: string | null
  inativo: boolean
}

export default async function CrmPage({ searchParams }: { searchParams: SearchParams }) {
  const [profile, sp] = await Promise.all([getProfile(), searchParams])
  const lojaId = profile.current_loja_id

  if (!lojaId) {
    return <EmptyState icon={Package} title="Selecione uma loja" hint="Escolha uma loja para ver o CRM." />
  }

  const tipo = sp.tipo === 'fornecedor' ? 'fornecedor' : 'cliente'
  const tabela = tipo === 'fornecedor' ? 'fornecedores' : 'clientes'
  const q = sp.q ?? ''
  const page = Math.max(1, Number(sp.page) || 1)

  const sb = await createClient()

  let query = sb
    .from(tabela)
    .select('codigo_omie,razao_social,nome_fantasia,cnpj_cpf,cidade,uf,telefone,inativo', { count: 'exact' })
    .eq('loja_id', lojaId)
    .order('razao_social')
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1)
  if (q) {
    const t = escapeIlikeOr(q)
    query = query.or(`razao_social.ilike.%${t}%,nome_fantasia.ilike.%${t}%,cnpj_cpf.ilike.%${t}%`)
  }

  const [listaRes, cliCountRes, fornCountRes] = await Promise.all([
    query,
    sb.from('clientes').select('*', { count: 'exact', head: true }).eq('loja_id', lojaId),
    sb.from('fornecedores').select('*', { count: 'exact', head: true }).eq('loja_id', lojaId),
  ])

  const lista = (listaRes.data ?? []) as ParceiroRow[]
  const total = listaRes.count ?? 0
  const temProxima = page * PER_PAGE < total
  const cliCount = cliCountRes.count ?? 0
  const fornCount = fornCountRes.count ?? 0

  const ABAS = [
    { value: 'cliente', label: `Clientes (${cliCount})`, icon: Users },
    { value: 'fornecedor', label: `Fornecedores (${fornCount})`, icon: Truck },
  ] as const

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM"
        icon={Users}
        description="Clientes e fornecedores com historico de NFs, contas abertas e ultimos precos."
      />

      {/* Abas */}
      <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 w-fit">
        {ABAS.map(a => (
          <Link
            key={a.value}
            href={`/beta/crm?tipo=${a.value}`}
            className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium u-motion ${tipo === a.value ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}
          >
            <a.icon className="size-3.5" /> {a.label}
          </Link>
        ))}
      </div>

      {/* Busca (form GET nativo, preserva tipo) */}
      <form action="/beta/crm" method="get" className="flex gap-2">
        <input type="hidden" name="tipo" value={tipo} />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por razao social, fantasia ou CNPJ/CPF..."
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-9 pr-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand"
          />
        </div>
        <button type="submit" className="shrink-0 rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white u-motion u-press-sm">
          Buscar
        </button>
      </form>

      {q && (
        <p className="text-[12px] text-text-muted">
          {total} resultado{total === 1 ? '' : 's'} para <strong className="text-text">{q}</strong> ·{' '}
          <Link href={`/beta/crm?tipo=${tipo}`} className="text-brand hover:underline">limpar</Link>
        </p>
      )}

      {/* Lista */}
      {lista.length === 0 ? (
        <EmptyState
          icon={tipo === 'fornecedor' ? Truck : Users}
          title={q ? 'Nada encontrado' : 'Nenhum registro'}
          hint={q ? 'Tente outro termo de busca.' : 'Cadastro ainda nao sincronizado do Omie.'}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Razao social</th>
                <th className="hidden px-3 py-2.5 text-left font-semibold text-text-muted sm:table-cell">CNPJ/CPF</th>
                <th className="hidden px-3 py-2.5 text-left font-semibold text-text-muted md:table-cell">Cidade/UF</th>
                <th className="px-3 py-2.5 text-right font-semibold text-text-muted"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lista.map((p) => (
                <tr key={p.codigo_omie} className="group hover:bg-surface-2/50">
                  <td className="px-3 py-2.5">
                    <Link href={`/beta/crm/${tipo}/${p.codigo_omie}`} className="block min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-text group-hover:text-brand">{p.razao_social}</span>
                        {p.inativo && <span className="shrink-0 rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">Inativo</span>}
                      </div>
                      {p.nome_fantasia && p.nome_fantasia !== p.razao_social && (
                        <div className="truncate text-[12px] text-text-muted">{p.nome_fantasia}</div>
                      )}
                    </Link>
                  </td>
                  <td className="hidden px-3 py-2.5 text-text-muted num sm:table-cell">{p.cnpj_cpf || '-'}</td>
                  <td className="hidden px-3 py-2.5 text-text-muted md:table-cell">{[p.cidade, p.uf].filter(Boolean).join('/') || '-'}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Link href={`/beta/crm/${tipo}/${p.codigo_omie}`} className="inline-flex text-text-muted/40 group-hover:text-brand">
                      <ChevronRight className="size-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/beta/crm" page={page} temProxima={temProxima} total={total} porPagina={PER_PAGE} />
      )}
    </div>
  )
}
