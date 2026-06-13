import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Num } from '@/components/ui-kit/Num'
import { CalendarClock } from 'lucide-react'

const LIMITE = 200
const PERIODOS = [3, 7, 15, 30] as const

// Retorna 'YYYY-MM-DD' de hoje + d dias.
function hojeMais(d: number): string {
  const dt = new Date()
  dt.setHours(0, 0, 0, 0)
  dt.setDate(dt.getDate() + d)
  return dt.toISOString().slice(0, 10)
}

// Diferença em dias entre a validade e hoje (negativo = vencido).
function diasAte(validade: string): number {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const v = new Date(`${validade}T00:00:00`)
  return Math.round((v.getTime() - hoje.getTime()) / 86400000)
}

// Cor por urgência.
function tom(validade: string): string {
  const dias = diasAte(validade)
  if (dias < 0) return '#ef4444' // vencido
  if (dias <= 3) return '#f59e0b' // crítico
  return '#64748b'
}

function formataData(validade: string): string {
  const [a, m, d] = validade.split('-')
  return `${d}/${m}/${a}`
}

export default async function ValidadePage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()

  const sp = await searchParams
  const dias = PERIODOS.includes(Number(sp.dias) as (typeof PERIODOS)[number])
    ? Number(sp.dias)
    : 7

  const supabase = await createClient()

  const { data: ordens } = await supabase
    .from('ordens_producao')
    .select('id, identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, quantidade, validade')
    .eq('loja_id', lojaId)
    .not('validade', 'is', null)
    .lte('validade', hojeMais(dias))
    .order('validade', { ascending: true })
    .limit(LIMITE)

  // Resolver descrição/código/unidade dos produtos relacionados.
  const codigos = [
    ...new Set((ordens ?? []).map((o) => o.identificacao_n_cod_produto).filter(Boolean)),
  ]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, codigo, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }

  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Validade"
        icon={CalendarClock}
        description="Produtos que vencem no período"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {PERIODOS.map((p) => {
          const ativo = p === dias
          return (
            <Link
              key={p}
              href={`/validade?dias=${p}`}
              className={`rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
                ativo
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-surface text-text-muted hover:bg-surface-2/60'
              }`}
            >
              {p} dias
            </Link>
          )
        })}
      </div>

      {ordens?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th className="w-40">Validade</th>
              <th>Produto</th>
              <th className="w-40">OP</th>
              <th className="w-28 text-right">Qtd</th>
            </tr>
          </thead>
          <tbody>
            {ordens.map((o) => {
              const prod = prodMap.get(o.identificacao_n_cod_produto)
              const cor = tom(o.validade as string)
              return (
                <tr key={o.id}>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2 rounded-full shrink-0" style={{ background: cor }} />
                      <span className="num text-text">{formataData(o.validade as string)}</span>
                    </span>
                  </td>
                  <td>
                    <span className="text-text">
                      {prod?.descricao || `Produto ${o.identificacao_n_cod_produto}`}
                    </span>
                    {prod?.codigo && (
                      <span className="ml-1.5 text-[12px] text-text-muted">{prod.codigo}</span>
                    )}
                  </td>
                  <td className="text-text-muted">
                    {o.identificacao_c_num_op || o.num_ordem || '-'}
                  </td>
                  <td className="text-right">
                    <Num value={o.quantidade ?? o.identificacao_n_qtde} frac={0} />
                    {prod?.unidade && (
                      <span className="ml-1 text-[12px] text-text-muted">{prod.unidade}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          icon={CalendarClock}
          title="Nada vencendo"
          hint="Nenhum produto vence nesse período."
        />
      )}
    </div>
  )
}
