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
import { formatQtdResumo } from '@/lib/num-br'
import { Money } from '@/components/ui-kit/Money'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { buscarFamilias } from '@/lib/actions/produto'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { ArrowLeftRight, AlertTriangle } from 'lucide-react'

const POR_PAGINA = 100
// Teto de linhas lidas para os totais e para o agrupamento por mes (em memoria).
const TETO_LINHAS = 100_000
// CMC absurdo: produto com CMC acima deste limite aciona aviso de guarda-corpo.
const CMC_ALERTA_UNITARIO = 500_000

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

/**
 * Historico de movimentacoes de estoque (entradas/saidas por produto/dia),
 * importado do Omie (movimentos_historico). Default: ultimos 30 dias.
 *
 * PADRÃO: modo=mes (por mes). Trocar para modo=data para ver por data.
 *
 * Valores estimados: quantidade x CMC atual do produto. O historico so guarda
 * quantidade; o custo usa o snapshot mais recente da posicao_estoques.
 *
 * ORIGEM/DESTINO: a tabela movimentos_historico e agregada (loja+produto+dia)
 * e NAO contem origem/destino de cada movimento. Exibir origem/destino
 * requer reimportar o movimento granular do Omie (ListarMovimentos com
 * detalhamento completo) — pendente de fase de dados.
 */
export default async function MovimentacoesPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    produto?: string
    familia?: string
    tipo?: string
    modo?: string
    page?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)
  // Padrao: por mes. So vai para "por data" quando modo=data esta explicitamente na URL.
  const porMes = sp.modo !== 'data'
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

  // CMC recente por produto (sempre carregado para exibir valores junto das quantidades).
  const cmcMap = new Map<number, number>()
  const { data: cmcs } = await supabase.rpc('cmc_recente_da_loja', { p_loja_id: lojaId })
  for (const c of (cmcs ?? []) as { n_cod_prod: number; cmc: number }[]) {
    cmcMap.set(Number(c.n_cod_prod), Number(c.cmc))
  }
  const cmcDe = (cod: number): number => cmcMap.get(Number(cod)) ?? 0
  // Verifica se algum CMC e suspeito (inflado).
  const temCmcAbsurdo = [...cmcMap.values()].some((v) => v > CMC_ALERTA_UNITARIO)

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

  // Totais do periodo (quantidade e valor estimado).
  let totalEntradas = 0
  let totalSaidas = 0
  let totalValEntradas = 0
  let totalValSaidas = 0

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
    temCmc: boolean
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
          temCmc: cmcMap.has(Number(r.cod_prod)),
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
      totalEntradas += g.entradas
      totalSaidas += g.saidas
      totalValEntradas += g.valEntradas
      totalValSaidas += g.valSaidas
    }
    // Ordena: mes mais recente primeiro; dentro do mes, maior saida primeiro.
    arr.sort((a, b) => {
      if (a.quando !== b.quando) return a.quando < b.quando ? 1 : -1
      return b.saidas - a.saidas
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
        temCmc: cmcMap.has(Number(m.cod_prod)),
      }
    })

    // Totais do periodo/filtro: soma entradas/saidas (qtd e valor). Le so as
    // colunas necessarias ate o teto.
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
      const cmc = cmcDe(r.cod_prod)
      totalEntradas += e
      totalSaidas += s
      totalValEntradas += e * cmc
      totalValSaidas += s * cmc
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

  // Valores em R$ OCULTOS por ora (decisao do fundador 20/06): o custo medio (CMC)
  // esta inconsistente na fonte (Omie) — produtos com saldo negativo fazem o custo
  // explodir, alem de custos cadastrados errados — entao a estimativa de valor mente
  // (chegava a R$ trilhoes). A tela foca na QUANTIDADE movimentada, que e confiavel.
  // Religar (true) quando o custo for corrigido no Omie. Ver roadmap fase 3.
  const MOSTRAR_VALORES = false

  const colValor = (n: number, temCmc: boolean) => {
    if (!temCmc) return <span className="text-text-muted text-[11px]">sem CMC</span>
    if (n <= 0) return <span className="text-text-muted">-</span>
    return <Money value={n} className="font-medium" />
  }
  // Quantidade AGREGADA (soma de vários dias): usa o resumo (2 casas) em vez do
  // exato (12 casas), senão a soma vira ruído de float ("155.001,7324").
  const colQtd = (n: number) =>
    n > 0 ? <span className="num font-medium">{formatQtdResumo(n)}</span> : <span className="text-text-muted">-</span>

  // Quantos produtos sem CMC ha nas linhas exibidas (para aviso).
  const semCmc = linhas.filter((l) => !l.temCmc && (l.entradas > 0 || l.saidas > 0)).length

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
              persistirEm="/movimentacoes"
            />
          }
        />
        <ChipsFiltrosAtivos basePath="/movimentacoes" campos={campos} naoMostrar={['data_inicio', 'data_final']} persistirEm="/movimentacoes" />
      </ListaHeader>

      {/* Controle de agrupamento: padrao por mes */}
      <div className="flex flex-wrap items-center gap-2.5">
        <SegmentLinks
          basePath="/movimentacoes"
          param="modo"
          aria-label="Agrupar por"
          opcoes={[
            { value: '', label: 'Por mês' },
            { value: 'data', label: 'Por data' },
          ]}
        />
      </div>

      {/* Barra de totais do periodo */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-text-muted">Período: {fmtData(ini)} a {fmtData(fim)}</span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Entradas{' '}
          <span className="num font-semibold text-ok">{formatQtdResumo(totalEntradas)}</span>
          {MOSTRAR_VALORES && totalValEntradas > 0 && (
            <span className="ml-1.5 text-ok/70">
              (<Money value={totalValEntradas} />)
            </span>
          )}
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Saídas{' '}
          <span className="num font-semibold text-err">{formatQtdResumo(totalSaidas)}</span>
          {MOSTRAR_VALORES && totalValSaidas > 0 && (
            <span className="ml-1.5 text-err/70">
              (<Money value={totalValSaidas} />)
            </span>
          )}
        </span>
      </div>

      {/* Avisos de valor so aparecem quando os valores estao visiveis (MOSTRAR_VALORES) */}
      {MOSTRAR_VALORES && temCmcAbsurdo && (
        <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-text-muted">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <span>
            <strong className="text-warn">CMC suspeito detectado</strong> — um ou mais produtos têm custo médio unitário acima de R${' '}
            {CMC_ALERTA_UNITARIO.toLocaleString('pt-BR')} no Omie. Os valores de entrada/saída podem estar inflados. Corrija o CMC na origem (Omie) e sincronize a posição.
          </span>
        </div>
      )}

      {MOSTRAR_VALORES && semCmc > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-text-muted">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span>
            {semCmc} produto{semCmc > 1 ? 's' : ''} nesta página sem CMC cadastrado no Omie. Valores estimados indicados como "sem CMC" nessas linhas.
          </span>
        </div>
      )}

      {/* Nota: valores ocultos (custo furado) ou metodologia (quando religar) */}
      {MOSTRAR_VALORES ? (
        <p className="rounded-md border border-border bg-surface/50 px-3 py-2 text-[12px] text-text-muted">
          Valores estimados: quantidade movimentada x CMC (custo medio) atual. O historico guarda so quantidade;
          o custo usa o snapshot mais recente da posicao de estoque, nao o custo exato de cada data.{' '}
          <strong>Origem/destino nao disponivel:</strong> a tabela de historico e agregada por produto/dia
          e nao contem o movimento granular.
        </p>
      ) : (
        <p className="rounded-md border border-border bg-surface/50 px-3 py-2 text-[12px] text-text-muted">
          <strong>Valores em R$ ocultos por enquanto</strong> (o custo do Omie está furado). A tela mostra só a
          quantidade movimentada, agregada por produto/dia.
        </p>
      )}

      <Lista
        linhas={linhas}
        chaveLinha={(m) => m.chave}
        colunas={[
          {
            label: porMes ? 'Mês' : 'Data',
            larguraDesktop: 'w-24',
            render: (m) => <span className="num text-text-muted">{porMes ? fmtMes(m.quando) : fmtData(m.quando)}</span>,
          },
          {
            label: 'Produto',
            primaria: true,
            flexivel: true,
            render: (m) => (
              <span>
                <span className="num text-text-muted">{m.codigo}</span>{' '}
                {formatarNomeProduto(m.descricao) || `Produto ${m.cod_prod}`}
              </span>
            ),
          },
          {
            label: 'Entradas (qtd)',
            alinhar: 'right',
            larguraDesktop: 'w-28',
            render: (m) => <span className="text-ok">{colQtd(m.entradas)}</span>,
          },
          ...(MOSTRAR_VALORES
            ? [{
                label: 'Entradas (R$)',
                alinhar: 'right' as const,
                larguraDesktop: 'w-32',
                render: (m: LinhaExibida) => <span className="text-ok">{colValor(m.valEntradas, m.temCmc)}</span>,
              }]
            : []),
          {
            label: 'Saídas (qtd)',
            alinhar: 'right',
            larguraDesktop: 'w-28',
            render: (m) => <span className="text-err">{colQtd(m.saidas)}</span>,
          },
          ...(MOSTRAR_VALORES
            ? [{
                label: 'Saídas (R$)',
                alinhar: 'right' as const,
                larguraDesktop: 'w-32',
                render: (m: LinhaExibida) => <span className="text-err">{colValor(m.valSaidas, m.temCmc)}</span>,
              }]
            : []),
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
