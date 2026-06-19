import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { Num } from '@/components/ui-kit/Num'
import { Money } from '@/components/ui-kit/Money'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { buscarFamilias } from '@/lib/actions/produto'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { ArrowLeftRight } from 'lucide-react'

const POR_PAGINA = 100
// Teto de linhas lidas para os totais e para o agrupamento por mes (em memoria).
const TETO_LINHAS = 100000

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = String(d).slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
// 'YYYY-MM' -> 'mmm/AAAA' (ex.: 2026-06 -> jun/2026)
function fmtMes(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MESES[Number(m) - 1] ?? m}/${y}`
}

// Historico de movimentacoes de estoque (entradas/saidas por produto/dia),
// importado do Omie (movimentos_historico). Default: ultimos 30 dias.
// vista=valor estima R$ multiplicando a quantidade pelo CMC recente do produto
// (o historico so guarda quantidade); modo=mes soma por produto/mes.
export default async function MovimentacoesPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    produto?: string
    familia?: string
    tipo?: string
    vista?: string
    modo?: string
    page?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  const emValor = sp.vista === 'valor'
  const porMes = sp.modo === 'mes'
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = sp.data_inicio || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const fim = sp.data_final || hojeISO

  const supabase = await createClient()

  // Tipo/familia nao existem em movimentos_historico -> resolve os codigos dos
  // produtos que batem e restringe os movimentos a eles.
  let codigosFiltro: number[] | null = null
  if (sp.tipo || sp.familia) {
    let pq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    if (sp.tipo) pq = pq.eq('tipo_item', sp.tipo)
    if (sp.familia) pq = pq.eq('descricao_familia', sp.familia)
    const { data } = await pq
    codigosFiltro = [...new Set((data ?? []).map((p) => p.codigo_produto).filter(Boolean))]
  }
  const codigosIn = codigosFiltro ? (codigosFiltro.length ? codigosFiltro : [-1]) : null
  const termo = sp.produto ? escapeIlikeOr(sp.produto) : null

  // CMC recente por produto (para valor estimado). So busca quando precisa (valor).
  const cmcMap = new Map<number, number>()
  if (emValor) {
    const { data: cmcs } = await supabase.rpc('cmc_recente_da_loja', { p_loja_id: lojaId })
    for (const c of (cmcs ?? []) as { n_cod_prod: number; cmc: number }[]) {
      cmcMap.set(Number(c.n_cod_prod), Number(c.cmc))
    }
  }
  const cmcDe = (cod: number): number => cmcMap.get(Number(cod)) ?? 0

  // Le todas as linhas do periodo/filtro (entradas/saidas por produto/dia). Serve
  // tanto para os totais quanto para o agrupamento por mes. Le em lotes ate o teto.
  type LinhaRaw = { cod_prod: number; codigo: string; descricao: string; data: string; entradas: number; saidas: number }
  async function lerTudo(): Promise<LinhaRaw[]> {
    const todas: LinhaRaw[] = []
    const LOTE = 1000
    for (let off = 0; off < TETO_LINHAS; off += LOTE) {
      let q = supabase
        .from('movimentos_historico')
        .select('cod_prod, codigo, descricao, data, entradas, saidas')
        .eq('loja_id', lojaId)
        .gte('data', ini)
        .lte('data', fim)
        .order('data', { ascending: false })
        .order('saidas', { ascending: false })
        .range(off, off + LOTE - 1)
      if (termo) q = q.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
      if (codigosIn) q = q.in('cod_prod', codigosIn)
      const { data } = await q
      const lote = (data ?? []) as LinhaRaw[]
      todas.push(...lote)
      if (lote.length < LOTE) break
    }
    return todas
  }

  // Totais do periodo (quantidade sempre; valor estimado quando vista=valor).
  let totalEntradas = 0
  let totalSaidas = 0

  // Linhas exibidas na tabela.
  type LinhaExibida = {
    chave: string
    quando: string // data (YYYY-MM-DD) ou mes (YYYY-MM)
    cod_prod: number
    codigo: string
    descricao: string
    entradas: number
    saidas: number
    valEntradas: number
    valSaidas: number
  }
  let linhas: LinhaExibida[] = []
  let temProxima = false

  if (porMes) {
    // Agrupa por (produto, mes) somando entradas/saidas. Tudo em memoria.
    const todas = await lerTudo()
    const grupos = new Map<string, LinhaExibida>()
    for (const r of todas) {
      const ym = String(r.data).slice(0, 7)
      const chave = `${r.cod_prod}-${ym}`
      let g = grupos.get(chave)
      if (!g) {
        g = {
          chave,
          quando: ym,
          cod_prod: r.cod_prod,
          codigo: r.codigo,
          descricao: r.descricao,
          entradas: 0,
          saidas: 0,
          valEntradas: 0,
          valSaidas: 0,
        }
        grupos.set(chave, g)
      }
      g.entradas += Number(r.entradas) || 0
      g.saidas += Number(r.saidas) || 0
    }
    let arr = [...grupos.values()]
    for (const g of arr) {
      const cmc = cmcDe(g.cod_prod)
      g.valEntradas = g.entradas * cmc
      g.valSaidas = g.saidas * cmc
      totalEntradas += emValor ? g.valEntradas : g.entradas
      totalSaidas += emValor ? g.valSaidas : g.saidas
    }
    // Ordena: mes mais recente primeiro; dentro do mes, maior saida (ou valor).
    arr.sort((a, b) => {
      if (a.quando !== b.quando) return a.quando < b.quando ? 1 : -1
      const sa = emValor ? a.valSaidas : a.saidas
      const sb = emValor ? b.valSaidas : b.saidas
      return sb - sa
    })
    temProxima = arr.length > page * POR_PAGINA
    linhas = arr.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)
  } else {
    // Por DATA: paginacao normal no banco para a tabela; totais lidos a parte.
    let query = supabase
      .from('movimentos_historico')
      .select('cod_prod, codigo, descricao, data, entradas, saidas')
      .eq('loja_id', lojaId)
      .gte('data', ini)
      .lte('data', fim)
      .order('data', { ascending: false })
      .order('saidas', { ascending: false })
      .range((page - 1) * POR_PAGINA, page * POR_PAGINA)
    if (termo) query = query.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
    if (codigosIn) query = query.in('cod_prod', codigosIn)
    const { data: movsRaw } = await query
    temProxima = (movsRaw?.length ?? 0) > POR_PAGINA
    const movs = (temProxima ? movsRaw!.slice(0, POR_PAGINA) : movsRaw ?? []) as LinhaRaw[]
    linhas = movs.map((m) => {
      const cmc = cmcDe(m.cod_prod)
      return {
        chave: `${m.cod_prod}-${m.data}`,
        quando: String(m.data).slice(0, 10),
        cod_prod: m.cod_prod,
        codigo: m.codigo,
        descricao: m.descricao,
        entradas: Number(m.entradas) || 0,
        saidas: Number(m.saidas) || 0,
        valEntradas: (Number(m.entradas) || 0) * cmc,
        valSaidas: (Number(m.saidas) || 0) * cmc,
      }
    })

    // Totais do periodo/filtro: soma entradas/saidas (qtd) e, se valor, soma
    // qtd x CMC. Le so as colunas necessarias ate o teto.
    let totaisQuery = supabase
      .from('movimentos_historico')
      .select('cod_prod, entradas, saidas')
      .eq('loja_id', lojaId)
      .gte('data', ini)
      .lte('data', fim)
      .limit(TETO_LINHAS)
    if (termo) totaisQuery = totaisQuery.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
    if (codigosIn) totaisQuery = totaisQuery.in('cod_prod', codigosIn)
    const { data: totaisRaw } = await totaisQuery
    for (const r of (totaisRaw ?? []) as { cod_prod: number; entradas: number; saidas: number }[]) {
      const e = Number(r.entradas) || 0
      const s = Number(r.saidas) || 0
      if (emValor) {
        const cmc = cmcDe(r.cod_prod)
        totalEntradas += e * cmc
        totalSaidas += s * cmc
      } else {
        totalEntradas += e
        totalSaidas += s
      }
    }
  }

  const familias = await buscarFamilias()

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f.descricao, label: f.descricao })) },
  ]

  const colValor = (n: number) =>
    n > 0 ? <Money value={n} className="font-medium" /> : <span className="text-text-muted">-</span>
  const colQtd = (n: number) =>
    n > 0 ? <span className="num font-medium"><Num value={n} frac={0} /></span> : <span className="text-text-muted">-</span>

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Movimentações"
          icon={ArrowLeftRight}
          description="Histórico de entradas e saídas por produto (2026)"
          actions={
            <FiltrosGaveta
              basePath="/movimentacoes"
              campos={campos}
              defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', produto: sp.produto ?? '', tipo: sp.tipo ?? '', familia: sp.familia ?? '' }}
              naoContar={['data_inicio', 'data_final']}
            />
          }
        />
        <ChipsFiltrosAtivos basePath="/movimentacoes" campos={campos} naoMostrar={['data_inicio', 'data_final']} />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <SegmentLinks
          basePath="/movimentacoes"
          param="vista"
          aria-label="Ver como"
          opcoes={[
            { value: '', label: 'Quantidade' },
            { value: 'valor', label: 'Valor (R$)' },
          ]}
        />
        <SegmentLinks
          basePath="/movimentacoes"
          param="modo"
          aria-label="Agrupar por"
          opcoes={[
            { value: '', label: 'Por data' },
            { value: 'mes', label: 'Por mês' },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-text-muted">Período: {fmtData(ini)} a {fmtData(fim)}</span>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-[13px] text-text-muted">
          Entradas{' '}
          {emValor ? (
            <Money value={totalEntradas} className="font-semibold text-ok" />
          ) : (
            <span className="num font-semibold text-ok"><Num value={totalEntradas} frac={0} /></span>
          )}
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-[13px] text-text-muted">
          Saídas{' '}
          {emValor ? (
            <Money value={totalSaidas} className="font-semibold text-err" />
          ) : (
            <span className="num font-semibold text-err"><Num value={totalSaidas} frac={0} /></span>
          )}
        </span>
      </div>

      {emValor && (
        <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-text-muted">
          Valor estimado: quantidade movimentada x CMC (custo médio) atual de cada produto. O histórico
          guarda só a quantidade, então o valor usa o custo mais recente, não o custo de cada dia. Valores
          muito altos indicam CMC cadastrado errado no Omie (custo do produto a corrigir na origem).
        </p>
      )}

      <Lista
        linhas={linhas}
        chaveLinha={(m) => m.chave}
        colunas={[
          {
            label: porMes ? 'Mês' : 'Data',
            larguraDesktop: 'w-28',
            render: (m) => <span className="num text-text-muted">{porMes ? fmtMes(m.quando) : fmtData(m.quando)}</span>,
          },
          {
            label: 'Produto',
            primaria: true,
            flexivel: true,
            render: (m) => (
              <span>
                <span className="num text-text-muted">{m.codigo}</span> {formatarNomeProduto(m.descricao) || `Produto ${m.cod_prod}`}
              </span>
            ),
          },
          {
            label: emValor ? 'Entradas (R$)' : 'Entradas',
            alinhar: 'right',
            larguraDesktop: emValor ? 'w-36' : 'w-28',
            render: (m) =>
              emValor ? (
                <span className="text-ok">{colValor(m.valEntradas)}</span>
              ) : (
                <span className="text-ok">{colQtd(m.entradas)}</span>
              ),
          },
          {
            label: emValor ? 'Saídas (R$)' : 'Saídas',
            alinhar: 'right',
            larguraDesktop: emValor ? 'w-36' : 'w-28',
            render: (m) =>
              emValor ? (
                <span className="text-err">{colValor(m.valSaidas)}</span>
              ) : (
                <span className="text-err">{colQtd(m.saidas)}</span>
              ),
          },
        ]}
        vazio={
          <EmptyState
            icon={ArrowLeftRight}
            title="Nenhuma movimentação"
            hint="Ajuste o período ou o produto. O histórico cobre 2026."
          />
        }
      />

      {(page > 1 || temProxima) && <Paginacao basePath="/movimentacoes" page={page} temProxima={temProxima} />}
    </div>
  )
}
