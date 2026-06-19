import React from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { Num } from '@/components/ui-kit/Num'
import type { Coluna } from '@/components/ui-kit/Lista'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { buscarFamilias } from '@/lib/actions/produto'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { urgenciaValidade, FUNDO_CLASSE, SELO_CLASSE } from '@/lib/status-cor'
import { AlertTriangle, CalendarClock, Printer } from 'lucide-react'

const LIMITE = 400

// Retorna 'YYYY-MM-DD' via hora local (evita off-by-one de fuso UTC).
function hojeISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

// Retorna 'YYYY-MM-DD' de hoje + d dias (local).
function hojeMais(d: number): string {
  const dt = new Date()
  dt.setDate(dt.getDate() + d)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const dia = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

// Diferenca em dias entre a validade e hoje (negativo = vencido). Parsing local.
function diasAte(validade: string): number {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const [a, m, d] = validade.split('-').map(Number)
  const v = new Date(a, m - 1, d)
  return Math.round((v.getTime() - hoje.getTime()) / 86400000)
}

function textoValidade(dias: number): string {
  if (dias < 0) return `vencido há ${-dias} dia${-dias === 1 ? '' : 's'}`
  if (dias === 0) return 'vence hoje'
  return `vence em ${dias} dia${dias === 1 ? '' : 's'}`
}

function formataData(validade: string): string {
  const [a, m, d] = validade.split('-')
  return `${d}/${m}/${a}`
}

type OrdemRow = {
  id: number
  identificacao_c_num_op: string | null
  num_ordem: string | null
  identificacao_n_cod_produto: number
  identificacao_n_qtde: number | null
  quantidade: number | null
  validade: string | null
}

type ProdutoRow = {
  codigo_produto: number
  codigo: string | null
  descricao: string | null
  unidade: string | null
}

// Classifica OP em secao do painel.
type Secao = 'vencidos' | 'hoje' | 'semana' | 'depois'

function secaoDeOp(dias: number): Secao {
  if (dias < 0) return 'vencidos'
  if (dias === 0) return 'hoje'
  if (dias <= 7) return 'semana'
  return 'depois'
}

export default async function ValidadePage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; familia?: string; produto?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Validade'))) notFound()

  const sp = await searchParams
  const supabase = await createClient()

  // Filtro por tipo + familia + busca de produto.
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

  // Busca todas as OPs com validade definida (sem saldo zero).
  let ordensQuery = supabase
    .from('ordens_producao')
    .select(
      'id, identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, quantidade, validade'
    )
    .eq('loja_id', lojaId)
    .not('validade', 'is', null)
    .order('validade', { ascending: true })
    .limit(LIMITE)

  if (codigosTipo !== null) {
    ordensQuery = ordensQuery.in(
      'identificacao_n_cod_produto',
      codigosTipo.length ? codigosTipo : [-1]
    )
  }

  const { data: ordensRaw } = await ordensQuery
  // Filtra saldo zero (quantidade nula/zero): sem estoque nao ha o que vencer.
  const ordens = ((ordensRaw ?? []) as OrdemRow[]).filter(
    (o) => Number(o.quantidade ?? o.identificacao_n_qtde ?? 0) > 0
  )

  // Separa por secao usando parsing local.
  const grupos: Record<Secao, OrdemRow[]> = {
    vencidos: [],
    hoje: [],
    semana: [],
    depois: [],
  }
  for (const op of ordens) {
    const dias = diasAte(op.validade as string)
    grupos[secaoDeOp(dias)].push(op)
  }
  // Vencidos: mais recente primeiro (ja esta em ASC de validade, inverte so esse grupo).
  grupos.vencidos = grupos.vencidos.slice().reverse()

  // Resolver descricao/codigo/unidade dos produtos relacionados.
  const codigos = [...new Set(ordens.map((o) => o.identificacao_n_cod_produto).filter(Boolean))]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, codigo, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }

  const prodMap = new Map(((produtos ?? []) as ProdutoRow[]).map((p) => [p.codigo_produto, p]))
  const familias = await buscarFamilias()

  const campos: CampoFiltro[] = [
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
    {
      tipo: 'select',
      nome: 'familia',
      label: 'Família',
      opcoes: familias.map((f) => ({ value: f.descricao, label: f.descricao })),
    },
  ]

  const qtdVencidos = grupos.vencidos.length
  const qtdSemana = grupos.hoje.length + grupos.semana.length

  const hoje = hojeISO()
  void hoje // usado so para confirmar parsing local no servidor

  function colunasSecao(secao: Secao): Coluna<OrdemRow>[] {
    return [
      {
        label: 'Produto',
        primaria: true,
        render: (o: OrdemRow) => {
          const prod = prodMap.get(o.identificacao_n_cod_produto)
          return (
            <Link href={`/ordem-producao/${o.id}`} className="group flex flex-col gap-0.5">
              <span className="text-text font-medium group-hover:text-brand transition-colors">
                {formatarNomeProduto(prod?.descricao) ||
                  `Produto ${o.identificacao_n_cod_produto}`}
              </span>
              {prod?.codigo && (
                <span className="text-[12px] text-text-muted">{prod.codigo}</span>
              )}
            </Link>
          )
        },
      },
      {
        label: 'Validade',
        larguraDesktop: 'w-48',
        render: (o: OrdemRow) => {
          const dias = diasAte(o.validade as string)
          const urgencia = urgenciaValidade(dias)
          return (
            <span className="inline-flex items-center gap-2">
              <span
                className={`size-2 rounded-full shrink-0 ${FUNDO_CLASSE[urgencia]}`}
              />
              <span className="flex flex-col">
                <span className="num text-[13px] text-text">{formataData(o.validade as string)}</span>
                <span className={`text-[11px] ${urgencia === 'err' ? 'text-err' : urgencia === 'warn' ? 'text-warn' : 'text-text-muted'}`}>
                  {textoValidade(dias)}
                </span>
              </span>
            </span>
          )
        },
      },
      {
        label: 'OP',
        larguraDesktop: 'w-36',
        render: (o: OrdemRow) => (
          <span className="text-text-muted text-[13px]">
            {o.identificacao_c_num_op || o.num_ordem || '-'}
          </span>
        ),
      },
      {
        label: 'Qtd',
        alinhar: 'right' as const,
        larguraDesktop: 'w-28',
        render: (o: OrdemRow) => {
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
    ]
  }

  function acaoImprimir(o: OrdemRow): React.ReactNode {
    return (
      <a
        href={`/ordem-producao/${o.id}/imprimir`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        title="Imprimir etiqueta"
      >
        <Printer className="size-3.5" strokeWidth={2} />
        <span className="hidden sm:inline">Imprimir</span>
      </a>
    )
  }

  const secoes: { id: Secao; label: string; empty: string }[] = [
    { id: 'vencidos', label: 'Vencidos', empty: 'Nenhum produto vencido.' },
    { id: 'hoje', label: 'Vencem hoje', empty: 'Nenhum produto vence hoje.' },
    { id: 'semana', label: 'Esta semana (até 7 dias)', empty: 'Nenhum produto vence nos próximos 7 dias.' },
    { id: 'depois', label: 'Depois (mais de 7 dias)', empty: 'Nenhum produto com validade além de 7 dias.' },
  ]

  return (
    <div className="space-y-6">
      <ListaHeader>
        <PageHeader
          title="Validade"
          icon={CalendarClock}
          description="Triagem de produtos por prazo de validade"
          actions={
            <FiltrosGaveta
              basePath="/validade"
              campos={campos}
              defaults={{
                produto: sp.produto ?? '',
                tipo: sp.tipo ?? '',
                familia: sp.familia ?? '',
              }}
              persistirEm="/validade"
            />
          }
        />
        <ChipsFiltrosAtivos basePath="/validade" campos={campos} persistirEm="/validade" />
      </ListaHeader>

      {/* Banner de alerta quando ha vencidos */}
      {qtdVencidos > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-err/30 bg-err/10 px-4 py-3">
          <AlertTriangle className="size-5 shrink-0 text-err" strokeWidth={2} />
          <p className="text-sm font-medium text-err">
            {qtdVencidos} produto{qtdVencidos !== 1 ? 's' : ''} vencido{qtdVencidos !== 1 ? 's' : ''} em estoque com saldo positivo
          </p>
        </div>
      )}

      {/* Cabecalho de resumo */}
      <div className="flex flex-wrap gap-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ${qtdVencidos > 0 ? SELO_CLASSE['err'] : SELO_CLASSE['neutro']}`}>
          {qtdVencidos} vencido{qtdVencidos !== 1 ? 's' : ''}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ${qtdSemana > 0 ? SELO_CLASSE['warn'] : SELO_CLASSE['neutro']}`}>
          {qtdSemana} vencem nos próximos 7 dias
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ${SELO_CLASSE['neutro']}`}>
          {grupos.depois.length} além de 7 dias
        </span>
      </div>

      {/* Secoes */}
      {secoes.map(({ id, label, empty }) => {
        const linhas = grupos[id]
        return (
          <section key={id} className="space-y-2">
            <div className="flex items-center gap-2">
              {id === 'vencidos' && <span className="size-2 rounded-full bg-err shrink-0" />}
              {id === 'hoje' && <span className="size-2 rounded-full bg-warn shrink-0" />}
              {id === 'semana' && <span className="size-2 rounded-full bg-warn/60 shrink-0" />}
              {id === 'depois' && <span className="size-2 rounded-full bg-text-muted/40 shrink-0" />}
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                {label}
                <span className="ml-2 font-normal">{linhas.length}</span>
              </h2>
            </div>
            {linhas.length > 0 ? (
              <Lista
                linhas={linhas}
                chaveLinha={(o) => o.id}
                colunas={colunasSecao(id)}
                acao={acaoImprimir}
                vazio={<EmptyState icon={CalendarClock} title="Nada aqui" hint={empty} />}
              />
            ) : (
              <div className="rounded-xl border border-border bg-surface px-4 py-3 text-[13px] text-text-muted">
                {empty}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
