import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { Num } from '@/components/ui-kit/Num'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { CalendarClock } from 'lucide-react'

const LIMITE = 200
const PERIODOS = [3, 7, 15, 30, 60] as const

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
  searchParams: Promise<{ dias?: string; tipo?: string; modo?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()

  const sp = await searchParams
  // Modo "vencidos": so os que ja venceram (validade < hoje), do mais vencido pro
  // menos. Senao, o que vence ate hoje + N dias.
  const vencidos = sp.modo === 'vencidos'
  const dias = PERIODOS.includes(Number(sp.dias) as (typeof PERIODOS)[number])
    ? Number(sp.dias)
    : 7

  const supabase = await createClient()

  // Filtro por tipo de produto: resolve os codigos do tipo escolhido (produto acabado
  // nao controla validade; em processo sim). null = sem filtro.
  let codigosTipo: number[] | null = null
  if (sp.tipo) {
    const { data: prodsTipo } = await supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', lojaId)
      .eq('tipo_item', sp.tipo)
    codigosTipo = [...new Set((prodsTipo ?? []).map((p) => p.codigo_produto).filter(Boolean))]
  }

  let ordensQuery = supabase
    .from('ordens_producao')
    .select('id, identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, quantidade, validade')
    .eq('loja_id', lojaId)
    .not('validade', 'is', null)
  ordensQuery = vencidos
    ? ordensQuery.lt('validade', hojeMais(0)).order('validade', { ascending: false })
    : ordensQuery.lte('validade', hojeMais(dias)).order('validade', { ascending: true })
  ordensQuery = ordensQuery.limit(LIMITE)

  if (codigosTipo !== null) {
    ordensQuery = ordensQuery.in('identificacao_n_cod_produto', codigosTipo.length ? codigosTipo : [-1])
  }

  const { data: ordens } = await ordensQuery

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
        actions={
          <FiltrosGaveta
            basePath="/validade"
            campos={[
              { tipo: 'select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
            ]}
            defaults={{ tipo: sp.tipo ?? '' }}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {PERIODOS.map((p) => {
          const ativo = !vencidos && p === dias
          const sufixoTipo = sp.tipo ? `&tipo=${sp.tipo}` : ''
          return (
            <Link
              key={p}
              href={`/validade?dias=${p}${sufixoTipo}`}
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
        <Link
          href={`/validade?modo=vencidos${sp.tipo ? `&tipo=${sp.tipo}` : ''}`}
          className={`rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
            vencidos
              ? 'border-[#ef4444] bg-[#ef44441f] text-[#ef4444]'
              : 'border-border bg-surface text-text-muted hover:bg-surface-2/60'
          }`}
        >
          Vencidos
        </Link>
      </div>

      <Lista
        linhas={ordens ?? []}
        chaveLinha={(o) => o.id}
        colunas={[
          {
            label: 'Produto',
            primaria: true,
            render: (o) => {
              const prod = prodMap.get(o.identificacao_n_cod_produto)
              return (
                <span>
                  <span className="text-text">
                    {formatarNomeProduto(prod?.descricao) || `Produto ${o.identificacao_n_cod_produto}`}
                  </span>
                  {prod?.codigo && (
                    <span className="ml-1.5 text-[12px] text-text-muted">{prod.codigo}</span>
                  )}
                </span>
              )
            },
          },
          {
            label: 'Validade',
            larguraDesktop: 'w-40',
            render: (o) => (
              <span className="inline-flex items-center gap-2">
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ background: tom(o.validade as string) }}
                />
                <span className="num text-text">{formataData(o.validade as string)}</span>
              </span>
            ),
          },
          {
            label: 'OP',
            larguraDesktop: 'w-40',
            render: (o) => (
              <span className="text-text-muted">
                {o.identificacao_c_num_op || o.num_ordem || '-'}
              </span>
            ),
          },
          {
            label: 'Qtd',
            alinhar: 'right',
            larguraDesktop: 'w-28',
            render: (o) => {
              const prod = prodMap.get(o.identificacao_n_cod_produto)
              return (
                <>
                  <Num value={o.quantidade ?? o.identificacao_n_qtde} frac={0} />
                  {prod?.unidade && (
                    <span className="ml-1 text-[12px] text-text-muted">{prod.unidade}</span>
                  )}
                </>
              )
            },
          },
        ]}
        vazio={
          <EmptyState
            icon={CalendarClock}
            title="Nada vencendo"
            hint="Nenhum produto vence nesse período."
          />
        }
      />
    </div>
  )
}
