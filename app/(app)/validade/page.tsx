import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { Num } from '@/components/ui-kit/Num'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { buscarFamilias } from '@/lib/actions/produto'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { urgenciaValidade, FUNDO_CLASSE } from '@/lib/status-cor'
import { CalendarClock } from 'lucide-react'

const LIMITE = 200
// 0 = "vence hoje" (so a data de hoje). Os demais sao horizontes acumulados:
// "7 dias" = vence de hoje ate +7. Cada um vira um chip de triagem com contagem.
const PERIODOS = [0, 7, 15, 30, 60] as const

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

function formataData(validade: string): string {
  const [a, m, d] = validade.split('-')
  return `${d}/${m}/${a}`
}

export default async function ValidadePage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; tipo?: string; modo?: string; familia?: string; produto?: string }>
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

  // Filtro por tipo + familia + busca de produto: resolve os codigos que batem em
  // TODOS os filtros e restringe as OPs a esses produtos. null = sem filtro.
  let codigosTipo: number[] | null = null
  if (sp.tipo || sp.familia || sp.produto) {
    let pq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    if (sp.tipo) pq = pq.eq('tipo_item', sp.tipo)
    if (sp.familia) pq = pq.eq('descricao_familia', sp.familia)
    if (sp.produto) {
      const e = escapeIlikeOr(sp.produto)
      pq = pq.or(`descricao.ilike.%${e}%,codigo.ilike.%${e}%`)
    }
    const { data: prodsTipo } = await pq
    codigosTipo = [...new Set((prodsTipo ?? []).map((p) => p.codigo_produto).filter(Boolean))]
  }

  let ordensQuery = supabase
    .from('ordens_producao')
    .select('id, identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, quantidade, validade')
    .eq('loja_id', lojaId)
    .not('validade', 'is', null)
  ordensQuery = vencidos
    ? ordensQuery.lt('validade', hojeMais(0)).order('validade', { ascending: false })
    : ordensQuery
        .gte('validade', hojeMais(0))
        .lte('validade', hojeMais(dias))
        .order('validade', { ascending: true })
  ordensQuery = ordensQuery.limit(LIMITE)

  if (codigosTipo !== null) {
    ordensQuery = ordensQuery.in('identificacao_n_cod_produto', codigosTipo.length ? codigosTipo : [-1])
  }

  const { data: ordensRaw } = await ordensQuery
  // Esconde OPs sem saldo (quantidade 0): sem unidade nao ha o que vencer.
  const ordens = (ordensRaw ?? []).filter(
    (o) => Number(o.quantidade ?? o.identificacao_n_qtde ?? 0) > 0
  )

  // Resolver descrição/código/unidade dos produtos relacionados.
  const codigos = [
    ...new Set(ordens.map((o) => o.identificacao_n_cod_produto).filter(Boolean)),
  ]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, codigo, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }

  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))
  const familias = await buscarFamilias()

  // Triagem por vencimento: conta no banco (head:true, sem trazer linha) quantas
  // OPs com saldo caem em cada horizonte, respeitando o mesmo filtro de
  // tipo/familia/produto. So conta OP com saldo (quantidade > 0; ou sem saldo
  // lancado mas com qtde produzida > 0) para bater com a lista.
  const SALDO_OR = 'quantidade.gt.0,and(quantidade.is.null,identificacao_n_qtde.gt.0)'
  function queryContagem() {
    let q = supabase
      .from('ordens_producao')
      .select('id', { count: 'exact', head: true })
      .eq('loja_id', lojaId)
      .not('validade', 'is', null)
      .or(SALDO_OR)
    if (codigosTipo !== null) {
      q = q.in('identificacao_n_cod_produto', codigosTipo.length ? codigosTipo : [-1])
    }
    return q
  }
  const hoje0 = hojeMais(0)
  const [cVencidos, c0, c7, c15, c30, c60] = await Promise.all(
    [
      queryContagem().lt('validade', hoje0),
      queryContagem().gte('validade', hoje0).lte('validade', hoje0),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(7)),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(15)),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(30)),
      queryContagem().gte('validade', hoje0).lte('validade', hojeMais(60)),
    ].map((p) => p.then((r) => r.count ?? 0)),
  )
  const contagemPeriodo: Record<number, number> = { 0: c0, 7: c7, 15: c15, 30: c30, 60: c60 }

  const campos: CampoFiltro[] = [
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f.descricao, label: f.descricao })) },
  ]

  // Preserva tipo/familia/produto ao trocar o periodo (chips).
  const extra = [
    sp.tipo && `tipo=${encodeURIComponent(sp.tipo)}`,
    sp.familia && `familia=${encodeURIComponent(sp.familia)}`,
    sp.produto && `produto=${encodeURIComponent(sp.produto)}`,
  ]
    .filter(Boolean)
    .join('&')
  const sufixo = extra ? `&${extra}` : ''

  return (
    <div className="space-y-4">
      <PageHeader
        title="Validade"
        icon={CalendarClock}
        description="Produtos que vencem no período"
        actions={
          <FiltrosGaveta
            basePath="/validade"
            campos={campos}
            defaults={{ produto: sp.produto ?? '', tipo: sp.tipo ?? '', familia: sp.familia ?? '' }}
          />
        }
      />

      <ChipsFiltrosAtivos basePath="/validade" campos={campos} />

      <div className="flex flex-wrap items-center gap-1.5">
        <Link
          href={`/validade?modo=vencidos${sufixo}`}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
            vencidos
              ? 'border-err bg-err/10 text-err'
              : 'border-border bg-surface text-text-muted hover:bg-surface-2/60'
          }`}
        >
          Vencidos
          <span
            className={`num text-[12px] tabular-nums ${
              cVencidos === 0
                ? 'opacity-40'
                : vencidos
                  ? 'font-semibold'
                  : 'font-semibold text-err'
            }`}
          >
            {cVencidos}
          </span>
        </Link>
        {PERIODOS.map((p) => {
          const ativo = !vencidos && p === dias
          const n = contagemPeriodo[p] ?? 0
          return (
            <Link
              key={p}
              href={`/validade?dias=${p}${sufixo}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
                ativo
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-border bg-surface text-text-muted hover:bg-surface-2/60'
              }`}
            >
              {p === 0 ? 'Vence hoje' : `${p} dias`}
              <span
                className={`num text-[12px] tabular-nums ${
                  n === 0 ? 'opacity-40' : ativo ? 'font-semibold' : 'font-semibold text-text'
                }`}
              >
                {n}
              </span>
            </Link>
          )
        })}
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
                  className={`size-2 rounded-full shrink-0 ${FUNDO_CLASSE[urgenciaValidade(diasAte(o.validade as string))]}`}
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
