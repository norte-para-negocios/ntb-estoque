import { createClient } from '@/lib/supabase/server'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { formatQtdResumo } from '@/lib/num-br'
import { Money } from '@/components/ui-kit/Money'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { AlertTriangle, ArrowLeftRight } from 'lucide-react'
import { BuscaProdutoInline } from '@/components/movimentacoes/BuscaProdutoInline'
import { FiltroDataInline } from '@/components/movimentacoes/FiltroDataInline'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { complementarMovimentosHistorico, limiteJanelaQuente } from '@/lib/historico-contabo'

const POR_PAGINA = 100
const TETO_LINHAS = 100_000
const CMC_ALERTA_UNITARIO = 500_000
const MOSTRAR_VALORES = false

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = String(d).slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
}

function fmtMes(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MESES[Number(m) - 1] ?? m}/${y}`
}

type SP = {
  data_inicio?: string
  data_final?: string
  produto?: string
  familia?: string
  tipo?: string
  modo?: string
  mov?: string
  page?: string
  local?: string
}

type LinhaRaw = { cod_prod: number; codigo: string; descricao: string; data: string; entradas: number; saidas: number }

type LinhaExibida = {
  chave: string
  quando: string
  cod_prod: number
  codigo: string
  descricao: string
  entradas: number
  saidas: number
  valEntradas: number
  valSaidas: number
  temCmc: boolean
}

export async function HistoricoTab({ sp, lojaId }: { sp: SP; lojaId: number }) {
  const supabase = await createClient()
  const page = Math.max(1, Number(sp.page) || 1)
  const porMes = sp.modo !== 'data' && !sp.produto
  const filtroMov = sp.mov === 'entrada' ? 'entrada' : sp.mov === 'saida' ? 'saida' : ''
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = sp.data_inicio || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const fim = sp.data_final || hojeISO

  const cmcMap = new Map<number, number>()
  const { data: cmcs } = await supabase.rpc('cmc_recente_da_loja', { p_loja_id: lojaId })
  for (const c of (cmcs ?? []) as { n_cod_prod: number; cmc: number }[]) {
    cmcMap.set(Number(c.n_cod_prod), Number(c.cmc))
  }
  const cmcDe = (cod: number): number => cmcMap.get(Number(cod)) ?? 0
  const temCmcAbsurdo = [...cmcMap.values()].some((v) => v > CMC_ALERTA_UNITARIO)

  // tipo/familia vem como lista separada por virgula (multi-select) na URL.
  const tiposArr = valoresMulti(sp.tipo)
  const familiasArr = valoresMulti(sp.familia)
  let codigosFiltro: number[] | null = null
  if (tiposArr.length || familiasArr.length) {
    let pq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    if (tiposArr.length) pq = pq.in('tipo_item', tiposArr)
    if (familiasArr.length) pq = pq.in('descricao_familia', familiasArr)
    const { data } = await pq
    codigosFiltro = [...new Set((data ?? []).map((p) => p.codigo_produto).filter(Boolean))]
  }
  // Local de estoque: movimentos_historico nao guarda local por movimento (o
  // ListarMovimentos do Omie nao traz essa informacao) — restringe aos produtos
  // que tem posicao de estoque no(s) local(is) escolhido(s), mesmo padrao proxy
  // ja usado em relatorio-movimentacao (modo quantidade).
  const locaisSel = valoresMulti(sp.local)
  if (locaisSel.length) {
    const { data } = await supabase
      .from('posicao_estoques')
      .select('n_cod_prod')
      .eq('loja_id', lojaId)
      .in('codigo_local_estoque', locaisSel.map(Number))
    const codigosLocal = new Set((data ?? []).map((p) => p.n_cod_prod as number))
    codigosFiltro = codigosFiltro === null ? [...codigosLocal] : codigosFiltro.filter((c) => codigosLocal.has(c))
  }
  const codigosIn = codigosFiltro ? (codigosFiltro.length ? codigosFiltro : [-1]) : null
  const termo = sp.produto ? escapeIlikeOr(sp.produto) : null

  // Achado real (usuario reportou Historico extremamente lento, 2026-07-28):
  // lojas com volume alto (ex.: loja 5, 9545 linhas so nos ultimos 30 dias)
  // paginavam em lotes de 1000 SEQUENCIALMENTE -- ate 10 idas ao banco, uma
  // esperando a anterior terminar, so pra montar a agregacao por mes. O app
  // roda no Contabo (Franca) e o banco fica no Brasil: cada ida paga
  // ~230-460ms de latencia de rede, entao 10 idas em serie viram 2-4+
  // segundos so nesta consulta. Pega o total antes (count exato, sem trazer
  // linha nenhuma) e dispara as paginas em paralelo (em ondas de
  // CONCORRENCIA_PAGINAS, pra nao estourar o pool de conexoes do Supabase
  // num periodo gigante) -- o tempo vira o da pagina mais lenta da onda, nao
  // a soma de todas.
  const CONCORRENCIA_PAGINAS = 10
  function baseQueryHistorico(selectExpr: string, opts?: { count: 'exact'; head: true }) {
    let q = supabase
      .from('movimentos_historico')
      .select(selectExpr, opts)
      .eq('loja_id', lojaId)
      .gte('data', ini)
      .lte('data', fim)
    if (termo) q = q.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
    if (codigosIn) q = q.in('cod_prod', codigosIn)
    return q
  }

  async function lerTudo(): Promise<LinhaRaw[]> {
    const LOTE = 1000
    const { count } = await baseQueryHistorico('cod_prod', { count: 'exact', head: true })
    const total = Math.min(count ?? 0, TETO_LINHAS)
    const numPaginas = Math.ceil(total / LOTE)

    const todas: LinhaRaw[] = []
    for (let inicio = 0; inicio < numPaginas; inicio += CONCORRENCIA_PAGINAS) {
      const tamanhoOnda = Math.min(CONCORRENCIA_PAGINAS, numPaginas - inicio)
      const onda = await Promise.all(
        Array.from({ length: tamanhoOnda }, (_, i) => {
          const pagina = inicio + i
          return baseQueryHistorico('cod_prod, codigo, descricao, data, entradas, saidas')
            .order('data', { ascending: false })
            .order('saidas', { ascending: false })
            .order('cod_prod', { ascending: true })
            .range(pagina * LOTE, pagina * LOTE + LOTE - 1)
        })
      )
      for (const r of onda) todas.push(...((r.data ?? []) as unknown as LinhaRaw[]))
    }

    if (ini < limiteJanelaQuente()) {
      return complementarMovimentosHistorico(todas, { lojaId, dataInicio: ini, dataFinal: fim })
    }
    return todas
  }

  let totalEntradas = 0
  let totalSaidas = 0
  let totalValEntradas = 0
  let totalValSaidas = 0
  let linhas: LinhaExibida[] = []
  let temProxima = false

  if (porMes) {
    const todas = await lerTudo()
    const grupos = new Map<string, LinhaExibida>()
    for (const r of todas) {
      const ym = String(r.data).slice(0, 7)
      const chave = `${r.cod_prod}-${ym}`
      let g = grupos.get(chave)
      if (!g) {
        g = {
          chave, quando: ym, cod_prod: r.cod_prod, codigo: r.codigo, descricao: r.descricao,
          entradas: 0, saidas: 0, valEntradas: 0, valSaidas: 0,
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
    }
    if (filtroMov === 'entrada') arr = arr.filter((g) => g.entradas > 0)
    else if (filtroMov === 'saida') arr = arr.filter((g) => g.saidas > 0)
    // Totais SEMPRE depois do filtro entrada/saída: senão o card do topo mostra
    // soma de linhas que nem aparecem na tabela (ex.: filtrar "Entradas" mas o
    // total de Saídas exibido incluir saídas de linhas ocultas).
    for (const g of arr) {
      totalEntradas += g.entradas
      totalSaidas += g.saidas
      totalValEntradas += g.valEntradas
      totalValSaidas += g.valSaidas
    }
    arr.sort((a, b) => {
      if (a.quando !== b.quando) return a.quando < b.quando ? 1 : -1
      return b.saidas - a.saidas
    })
    temProxima = arr.length > page * POR_PAGINA
    linhas = arr.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)
  } else if (ini < limiteJanelaQuente()) {
    // Periodo cruza a janela quente: paginacao nativa do Supabase sozinha nao e
    // confiavel (o Contabo pode ter linhas no meio do intervalo) -- reusa lerTudo()
    // (ja completa com o Contabo) e pagina/filtra em memoria.
    let todas = await lerTudo()
    if (filtroMov === 'entrada') todas = todas.filter((m) => Number(m.entradas) > 0)
    else if (filtroMov === 'saida') todas = todas.filter((m) => Number(m.saidas) > 0)
    todas.sort((a, b) => {
      if (a.data !== b.data) return a.data < b.data ? 1 : -1
      if (a.saidas !== b.saidas) return b.saidas - a.saidas
      return a.cod_prod < b.cod_prod ? -1 : a.cod_prod > b.cod_prod ? 1 : 0
    })
    const inicio = (page - 1) * POR_PAGINA
    const fatia = todas.slice(inicio, inicio + POR_PAGINA + 1)
    temProxima = fatia.length > POR_PAGINA
    const movs = temProxima ? fatia.slice(0, POR_PAGINA) : fatia
    linhas = movs.map((m) => {
      const cmc = cmcDe(m.cod_prod)
      return {
        chave: `${m.cod_prod}-${m.data}`,
        quando: String(m.data).slice(0, 10),
        cod_prod: m.cod_prod, codigo: m.codigo, descricao: m.descricao,
        entradas: Number(m.entradas) || 0,
        saidas: Number(m.saidas) || 0,
        valEntradas: (Number(m.entradas) || 0) * cmc,
        valSaidas: (Number(m.saidas) || 0) * cmc,
        temCmc: cmcMap.has(Number(m.cod_prod)),
      }
    })
    for (const r of todas) {
      const e = Number(r.entradas) || 0
      const s = Number(r.saidas) || 0
      const cmc = cmcDe(r.cod_prod)
      totalEntradas += e
      totalSaidas += s
      totalValEntradas += e * cmc
      totalValSaidas += s * cmc
    }
  } else {
    let query = supabase
      .from('movimentos_historico')
      .select('cod_prod, codigo, descricao, data, entradas, saidas')
      .eq('loja_id', lojaId)
      .gte('data', ini)
      .lte('data', fim)
      .order('data', { ascending: false })
      .order('saidas', { ascending: false })
      .order('cod_prod', { ascending: true })
      .range((page - 1) * POR_PAGINA, page * POR_PAGINA)
    if (termo) query = query.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
    if (codigosIn) query = query.in('cod_prod', codigosIn)
    if (filtroMov === 'entrada') query = query.gt('entradas', 0)
    else if (filtroMov === 'saida') query = query.gt('saidas', 0)
    const { data: movsRaw } = await query
    temProxima = (movsRaw?.length ?? 0) > POR_PAGINA
    const movs = (temProxima ? movsRaw!.slice(0, POR_PAGINA) : movsRaw ?? []) as LinhaRaw[]
    linhas = movs.map((m) => {
      const cmc = cmcDe(m.cod_prod)
      return {
        chave: `${m.cod_prod}-${m.data}`,
        quando: String(m.data).slice(0, 10),
        cod_prod: m.cod_prod, codigo: m.codigo, descricao: m.descricao,
        entradas: Number(m.entradas) || 0,
        saidas: Number(m.saidas) || 0,
        valEntradas: (Number(m.entradas) || 0) * cmc,
        valSaidas: (Number(m.saidas) || 0) * cmc,
        temCmc: cmcMap.has(Number(m.cod_prod)),
      }
    })

    let totaisQuery = supabase
      .from('movimentos_historico')
      .select('cod_prod, entradas, saidas')
      .eq('loja_id', lojaId)
      .gte('data', ini)
      .lte('data', fim)
      .limit(TETO_LINHAS)
    if (termo) totaisQuery = totaisQuery.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
    if (codigosIn) totaisQuery = totaisQuery.in('cod_prod', codigosIn)
    // Mesmo filtro entrada/saída da query principal: senão o total do topo soma
    // linhas que o filtro escondeu da tabela.
    if (filtroMov === 'entrada') totaisQuery = totaisQuery.gt('entradas', 0)
    else if (filtroMov === 'saida') totaisQuery = totaisQuery.gt('saidas', 0)
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

  const semCmc = linhas.filter((l) => !l.temCmc && (l.entradas > 0 || l.saidas > 0)).length

  const colValor = (n: number, temCmc: boolean) => {
    if (!temCmc) return <span className="text-text-muted text-[11px]">sem CMC</span>
    if (n <= 0) return <span className="text-text-muted">-</span>
    return <Money value={n} className="font-medium" />
  }

  const colQtd = (n: number) =>
    n > 0 ? <span className="num font-medium">{formatQtdResumo(n)}</span> : <span className="text-text-muted">-</span>

  return (
    <div className="space-y-4">
      <BuscaProdutoInline valorAtual={sp.produto ?? ''} />

      <div className="flex flex-wrap items-center gap-2.5">
        <SegmentLinks
          basePath="/movimentacoes"
          param="modo"
          opcoes={[
            { value: '', label: 'Por mês' },
            { value: 'data', label: 'Por data' },
          ]}
        />
        <SegmentLinks
          basePath="/movimentacoes"
          param="mov"
          opcoes={[
            { value: '', label: 'Tudo' },
            { value: 'entrada', label: 'Entradas' },
            { value: 'saida', label: 'Saídas' },
          ]}
        />
        <FiltroDataInline ini={ini} fim={fim} />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Entradas <span className="num font-semibold text-ok">{formatQtdResumo(totalEntradas)}</span>
          {MOSTRAR_VALORES && totalValEntradas > 0 && (
            <span className="ml-1.5 text-ok/70">(<Money value={totalValEntradas} />)</span>
          )}
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Saídas <span className="num font-semibold text-err">{formatQtdResumo(totalSaidas)}</span>
          {MOSTRAR_VALORES && totalValSaidas > 0 && (
            <span className="ml-1.5 text-err/70">(<Money value={totalValSaidas} />)</span>
          )}
        </span>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-surface/50 px-3 py-2 text-[12px] text-text-muted">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span>
          Entradas/Saídas somam a loja inteira e <strong>incluem transferências entre locais desta mesma loja</strong> —
          a Omie conta a saída do local de origem sem compensar com a entrada no destino, então um dia com
          transferência grande infla este número mesmo sem o produto ter saído de verdade do estoque. Pra ver
          quanto realmente sobrou/faltou num local específico, use o filtro de local na aba <strong>Movimentos</strong>{' '}
          (mostra Saldo inicial/final, que não é afetado por transferência interna).
        </span>
      </div>

      {MOSTRAR_VALORES && temCmcAbsurdo && (
        <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-text-muted">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <span>
            <strong className="text-warn">CMC suspeito detectado</strong> — um ou mais produtos têm custo médio
            unitário acima de R$ {CMC_ALERTA_UNITARIO.toLocaleString('pt-BR')} no Omie.
          </span>
        </div>
      )}

      {MOSTRAR_VALORES && semCmc > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-text-muted">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span>{semCmc} produto{semCmc > 1 ? 's' : ''} sem CMC nesta página.</span>
        </div>
      )}

      <p className="rounded-md border border-border bg-surface/50 px-3 py-2 text-[12px] text-text-muted">
        <strong>Valores em R$ ocultos por enquanto</strong> (o custo do Omie está furado). A tela mostra só a
        quantidade movimentada, agregada por produto/dia.
      </p>

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
            ? [{ label: 'Entradas (R$)', alinhar: 'right' as const, larguraDesktop: 'w-32',
                render: (m: LinhaExibida) => <span className="text-ok">{colValor(m.valEntradas, m.temCmc)}</span> }]
            : []),
          {
            label: 'Saídas (qtd)',
            alinhar: 'right',
            larguraDesktop: 'w-28',
            render: (m) => <span className="text-err">{colQtd(m.saidas)}</span>,
          },
          ...(MOSTRAR_VALORES
            ? [{ label: 'Saídas (R$)', alinhar: 'right' as const, larguraDesktop: 'w-32',
                render: (m: LinhaExibida) => <span className="text-err">{colValor(m.valSaidas, m.temCmc)}</span> }]
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
