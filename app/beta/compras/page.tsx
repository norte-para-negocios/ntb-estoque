import Link from 'next/link'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { ShoppingCart, Truck, Package, Search, ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'

type SearchParams = Promise<{ aba?: string; desde?: string; q?: string }>

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

const PERIODOS = [
  { value: '', label: 'Tudo' },
  { value: '90', label: '3 meses' },
  { value: '180', label: '6 meses' },
  { value: '365', label: '12 meses' },
]

export default async function ComprasPage({ searchParams }: { searchParams: SearchParams }) {
  const [profile, sp] = await Promise.all([getProfile(), searchParams])
  const lojaId = profile.current_loja_id
  if (!lojaId) return <EmptyState icon={Package} title="Selecione uma loja" hint="Escolha uma loja para ver as compras." />

  const aba = sp.aba === 'produtos' ? 'produtos' : 'fornecedores'
  const desde = sp.desde ?? ''
  const q = sp.q ?? ''
  const dataDesde = desde ? new Date(Date.now() - Number(desde) * 86400000).toISOString().slice(0, 10) : null

  const sb = await createClient()

  const [rankingRes, precosRes] = await Promise.all([
    aba === 'fornecedores'
      ? sb.rpc('compras_ranking_fornecedores', { p_loja_id: lojaId, p_desde: dataDesde })
      : Promise.resolve({ data: null }),
    aba === 'produtos'
      ? sb.rpc('compras_precos_produtos', { p_loja_id: lojaId, p_busca: q || null })
      : Promise.resolve({ data: null }),
  ])

  const ranking = (rankingRes.data ?? []) as { codigo_omie: number; razao_social: string; total: number; qtd_nf: number; ultima_compra: string | null }[]
  const precos = (precosRes.data ?? []) as { codigo: string; descricao: string; ultimo_preco: number; ultima_data: string | null; menor_preco: number; maior_preco: number; preco_tipico: number; qtd_compras: number }[]

  const totalComprado = ranking.reduce((s, r) => s + Number(r.total ?? 0), 0)
  const maxTotal = Number(ranking[0]?.total ?? 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras"
        icon={ShoppingCart}
        description="Ranking de fornecedores e evolucao de precos dos insumos, a partir das notas de entrada."
      />

      {/* Abas */}
      <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 w-fit">
        <Link href="/beta/compras?aba=fornecedores" className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium u-motion ${aba === 'fornecedores' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}>
          <Truck className="size-3.5" /> Fornecedores
        </Link>
        <Link href="/beta/compras?aba=produtos" className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium u-motion ${aba === 'produtos' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}>
          <Package className="size-3.5" /> Precos de produtos
        </Link>
      </div>

      {aba === 'fornecedores' ? (
        <>
          {/* Periodo */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-text-muted">Periodo:</span>
            {PERIODOS.map(p => (
              <Link key={p.value} href={`/beta/compras?aba=fornecedores${p.value ? `&desde=${p.value}` : ''}`}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium u-motion u-press-sm ${desde === p.value ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'}`}
              >{p.label}</Link>
            ))}
            {ranking.length > 0 && (
              <span className="ml-auto text-[12px] text-text-muted">
                Top {ranking.length} · total <strong className="text-text num"><Money value={totalComprado} /></strong>
              </span>
            )}
          </div>

          {ranking.length === 0 ? (
            <EmptyState icon={Truck} title="Sem compras" hint="Nenhuma nota de entrada no periodo." />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-8">#</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Fornecedor</th>
                    <th className="hidden px-3 py-2.5 text-right font-semibold text-text-muted sm:table-cell">NFs</th>
                    <th className="hidden px-3 py-2.5 text-left font-semibold text-text-muted md:table-cell">Ultima compra</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Total comprado</th>
                    <th className="px-3 py-2.5 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ranking.map((r, i) => {
                    const pct = maxTotal > 0 ? (Number(r.total) / maxTotal) * 100 : 0
                    return (
                      <tr key={r.codigo_omie} className="group hover:bg-surface-2/50">
                        <td className="px-3 py-2.5 text-text-muted num tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <Link href={`/beta/crm/fornecedor/${r.codigo_omie}`} className="block font-medium text-text group-hover:text-brand">{r.razao_social}</Link>
                          <div className="mt-1.5 h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-surface-2">
                            <div className="h-full rounded-full bg-brand/70" style={{ width: `${Math.max(2, pct)}%` }} />
                          </div>
                        </td>
                        <td className="hidden px-3 py-2.5 text-right text-text-muted num sm:table-cell">{r.qtd_nf}</td>
                        <td className="hidden px-3 py-2.5 text-text-muted md:table-cell">{fmtData(r.ultima_compra)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-text num">
                          <Money value={Number(r.total)} />
                          <div className="text-[10px] font-normal text-text-muted">{pct.toFixed(0)}% do topo</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <Link href={`/beta/crm/fornecedor/${r.codigo_omie}`} className="inline-flex text-text-muted/40 group-hover:text-brand"><ChevronRight className="size-4" /></Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Busca produtos */}
          <form action="/beta/compras" method="get" className="flex gap-2">
            <input type="hidden" name="aba" value="produtos" />
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
              <input name="q" defaultValue={q} placeholder="Buscar insumo por nome ou codigo..."
                className="w-full rounded-md border border-border bg-surface py-1.5 pl-9 pr-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand" />
            </div>
            <button type="submit" className="shrink-0 rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white u-motion u-press-sm">Buscar</button>
          </form>

          {precos.length === 0 ? (
            <EmptyState icon={Package} title={q ? 'Nada encontrado' : 'Sem dados'} hint={q ? 'Tente outro termo.' : 'Nenhum item de nota de entrada.'} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Insumo</th>
                    <th className="hidden px-3 py-2.5 text-right font-semibold text-text-muted sm:table-cell">Compras</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Ultimo</th>
                    <th className="hidden px-3 py-2.5 text-right font-semibold text-text-muted md:table-cell">Menor</th>
                    <th className="hidden px-3 py-2.5 text-right font-semibold text-text-muted md:table-cell">Tipico</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Tendencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {precos.map((p) => {
                    const tipico = Number(p.preco_tipico)
                    const ult = Number(p.ultimo_preco)
                    const variacao = tipico > 0 ? (ult - tipico) / tipico : 0
                    const acima = variacao > 0.05
                    const abaixo = variacao < -0.05
                    const Icon = acima ? TrendingUp : abaixo ? TrendingDown : Minus
                    const cor = acima ? 'text-err' : abaixo ? 'text-ok' : 'text-text-muted'
                    return (
                      <tr key={p.codigo} className="hover:bg-surface-2/50">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-text">{p.descricao}</div>
                          <div className="text-[11px] text-text-muted">{p.codigo} · {fmtData(p.ultima_data)}</div>
                        </td>
                        <td className="hidden px-3 py-2.5 text-right text-text-muted num sm:table-cell">{p.qtd_compras}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-text num"><Money value={ult} /></td>
                        <td className="hidden px-3 py-2.5 text-right text-ok num md:table-cell"><Money value={Number(p.menor_preco)} /></td>
                        <td className="hidden px-3 py-2.5 text-right text-text-muted num md:table-cell"><Money value={tipico} /></td>
                        <td className={`px-3 py-2.5 text-right num ${cor}`}>
                          <span className="inline-flex items-center justify-end gap-1">
                            <Icon className="size-3.5" />
                            {Math.abs(variacao * 100).toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-text-muted">
            Tipico = mediana dos precos pagos (resistente a erros de digitacao na nota). Tendencia compara o ultimo preco com o tipico: vermelho = pagando acima (encareceu); verde = abaixo.
          </p>
        </>
      )}
    </div>
  )
}
