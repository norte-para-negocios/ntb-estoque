import { createClient } from '@/lib/supabase/server'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { formatQtdResumo } from '@/lib/num-br'
import { Money } from '@/components/ui-kit/Money'
import { buscarTudoPaginado, escapeIlikeOr } from '@/lib/utils-busca'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { AlertTriangle, ArrowLeftRight, Info } from 'lucide-react'
import { BuscaProdutoInline } from '@/components/movimentacoes/BuscaProdutoInline'
import { FiltroDataInline } from '@/components/movimentacoes/FiltroDataInline'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { agregarHistorico, type LinhaHist } from '@/lib/movimentacoes/historico-puro'

const POR_PAGINA = 100
const TETO_LINHAS = 100_000
const CONCORRENCIA_PAGINAS = 10
const MAX_IDS_URL = 300
const CMC_ALERTA_UNITARIO = 500_000
const MOSTRAR_VALORES = false

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = String(d).slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
}

function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
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

export async function HistoricoTab({ sp, lojaId, proprio = false }: { sp: SP; lojaId: number; proprio?: boolean }) {
  const supabase = await createClient()
  const page = Math.max(1, Number(sp.page) || 1)
  const porMes = sp.modo !== 'data' && !sp.produto
  const filtroMov = sp.mov === 'entrada' ? 'entrada' : sp.mov === 'saida' ? 'saida' : ''
  const hojeISO = hojeBahiaISO()
  const ini = sp.data_inicio || addDias(hojeISO, -30)
  const fim = sp.data_final || hojeISO

  // Valores em R$ estão ocultos (MOSTRAR_VALORES): sem eles, o custo médio da loja inteira nem é lido.
  const cmcMap = new Map<number, number>()
  if (MOSTRAR_VALORES) {
    const { data: cmcs } = await supabase.rpc('cmc_recente_da_loja', { p_loja_id: lojaId })
    for (const c of (cmcs ?? []) as { n_cod_prod: number; cmc: number }[]) cmcMap.set(Number(c.n_cod_prod), Number(c.cmc))
  }
  const cmcDe = (cod: number): number => cmcMap.get(Number(cod)) ?? 0
  const temCmcAbsurdo = [...cmcMap.values()].some((v) => v > CMC_ALERTA_UNITARIO)

  // tipo/familia vem como lista separada por virgula (multi-select) na URL. Paginado com ordem total: as lojas
  // têm 2.300–2.900 produtos e o PostgREST corta em 1000 (antes o filtro perdia produtos em silêncio).
  const tiposArr = valoresMulti(sp.tipo)
  const familiasArr = valoresMulti(sp.familia)
  let codigosFiltro: Set<number> | null = null
  if (tiposArr.length || familiasArr.length) {
    const prods = await buscarTudoPaginado<{ codigo_produto: number }>((from, to) => {
      let pq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).order('id').range(from, to)
      if (tiposArr.length) pq = pq.in('tipo_item', tiposArr)
      if (familiasArr.length) pq = pq.in('descricao_familia', familiasArr)
      return pq
    })
    codigosFiltro = new Set(prods.map((p) => Number(p.codigo_produto)))
  }
  // Local de estoque: movimentos_historico nao guarda local por movimento — restringe aos produtos com posição no(s)
  // local(is) na foto mais recente (antes lia todas as fotos sem paginar e cortava em 1000 linhas).
  const locaisSel = valoresMulti(sp.local)
  if (locaisSel.length) {
    const { data: ult } = await supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).order('data_posicao', { ascending: false }).limit(1)
    const dataFoto = ult?.[0]?.data_posicao
    const pos = dataFoto
      ? await buscarTudoPaginado<{ n_cod_prod: number }>((from, to) => supabase.from('posicao_estoques').select('n_cod_prod').eq('loja_id', lojaId)
          .eq('data_posicao', dataFoto).in('codigo_local_estoque', locaisSel.map(Number)).order('id').range(from, to))
      : []
    const doLocal = new Set(pos.map((p) => Number(p.n_cod_prod)))
    codigosFiltro = codigosFiltro === null ? doLocal : new Set([...codigosFiltro].filter((c) => doLocal.has(c)))
  }
  const termo = sp.produto ? escapeIlikeOr(sp.produto) : null
  // Lista pequena vai no filtro do banco; lista grande fica em memória (URL longa = 414 = "nenhum resultado").
  const codigosNoBanco = codigosFiltro && codigosFiltro.size <= MAX_IDS_URL ? [...codigosFiltro] : null

  // Uma leitura só do período (banco principal tem o histórico desde 2025-07-01: sem ida ao Contabo), com a
  // contagem antes e as páginas em paralelo (o app e o banco ficam em continentes diferentes).
  function baseQuery(selectExpr: string, opts?: { count: 'exact'; head: true }) {
    let q = supabase.from('movimentos_historico').select(selectExpr, opts).eq('loja_id', lojaId).gte('data', ini).lte('data', fim)
    if (termo) q = q.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
    if (codigosNoBanco) q = q.in('cod_prod', codigosNoBanco.length ? codigosNoBanco : [-1])
    if (filtroMov === 'entrada') q = q.gt('entradas', 0)
    else if (filtroMov === 'saida') q = q.gt('saidas', 0)
    return q
  }
  // Falha de consulta vira aviso na tela (nunca "nenhum resultado" calado).
  let falhaLeitura: string | null = null
  const contagem = codigosFiltro && !codigosFiltro.size ? { count: 0, error: null } : await baseQuery('cod_prod', { count: 'exact', head: true })
  if (contagem.error) falhaLeitura = contagem.error.message
  const count = contagem.count
  const truncado = (count ?? 0) > TETO_LINHAS
  const numPaginas = Math.ceil(Math.min(count ?? 0, TETO_LINHAS) / 1000)
  const todas: LinhaHist[] = []
  for (let inicio = 0; inicio < numPaginas; inicio += CONCORRENCIA_PAGINAS) {
    const onda = await Promise.all(
      Array.from({ length: Math.min(CONCORRENCIA_PAGINAS, numPaginas - inicio) }, (_, i) => {
        const p = inicio + i
        return baseQuery('cod_prod, codigo, descricao, data, entradas, saidas').order('data', { ascending: false }).order('cod_prod').range(p * 1000, p * 1000 + 999)
      })
    )
    for (const r of onda) {
      if (r.error) falhaLeitura = r.error.message
      todas.push(...((r.data ?? []) as unknown as LinhaHist[]))
    }
  }
  const ag = agregarHistorico(todas, {
    porMes, mov: filtroMov, codigos: codigosFiltro && !codigosNoBanco ? codigosFiltro : null, page, porPagina: POR_PAGINA,
  })
  const totalEntradas = ag.totalEntradas
  const totalSaidas = ag.totalSaidas
  const totalValEntradas = MOSTRAR_VALORES ? todas.reduce((s, r) => s + (Number(r.entradas) || 0) * cmcDe(r.cod_prod), 0) : 0
  const totalValSaidas = MOSTRAR_VALORES ? todas.reduce((s, r) => s + (Number(r.saidas) || 0) * cmcDe(r.cod_prod), 0) : 0
  const temProxima = ag.temProxima
  const linhas: LinhaExibida[] = ag.linhas.map((g) => ({
    chave: g.chave, quando: g.quando, cod_prod: g.cod_prod, codigo: g.codigo ?? '', descricao: g.descricao ?? '',
    entradas: g.entradas, saidas: g.saidas, valEntradas: g.entradas * cmcDe(g.cod_prod), valSaidas: g.saidas * cmcDe(g.cod_prod),
    temCmc: cmcMap.has(Number(g.cod_prod)),
  }))

  const semCmc = linhas.filter((l) => !l.temCmc && (l.entradas > 0 || l.saidas > 0)).length

  const colValor = (n: number, temCmc: boolean) => {
    if (!temCmc) return <span className="text-[12px] text-text-muted">sem CMC</span>
    if (n <= 0) return <span className="text-text-muted">-</span>
    return <Money value={n} className="font-medium" />
  }

  const colQtd = (n: number) =>
    n > 0 ? <span className="num font-medium">{formatQtdResumo(n)}</span> : <span className="text-text-muted">-</span>

  return (
    <div className="space-y-4">
      <BuscaProdutoInline valorAtual={sp.produto ?? ''} />

      {/* Celular: um grupo por linha (sem quebrar o período no meio); desktop: tudo numa linha. */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
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
        </div>
        <FiltroDataInline ini={ini} fim={fim} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
          Entradas <span className="num font-semibold text-ok">{formatQtdResumo(totalEntradas)}</span>
          {MOSTRAR_VALORES && totalValEntradas > 0 && (
            <span className="text-text-muted">(<Money value={totalValEntradas} />)</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
          Saídas <span className="num font-semibold text-err">{formatQtdResumo(totalSaidas)}</span>
          {MOSTRAR_VALORES && totalValSaidas > 0 && (
            <span className="text-text-muted">(<Money value={totalValSaidas} />)</span>
          )}
        </span>
      </div>

      {falhaLeitura && (
        <div className="flex items-start gap-2.5 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] leading-relaxed text-text-muted shadow-[var(--shadow-sm)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-err" />
          <span>Falha ao ler o histórico ({falhaLeitura}): os números abaixo podem estar incompletos. Recarregue a página.</span>
        </div>
      )}

      {truncado && (
        <div className="flex items-start gap-2.5 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] leading-relaxed text-text-muted shadow-[var(--shadow-sm)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <span>Período com mais de {TETO_LINHAS.toLocaleString('pt-BR')} linhas: os números abaixo cobrem só parte. Diminua o período ou filtre um produto.</span>
        </div>
      )}

      {!proprio && (
      <div className="flex items-start gap-2.5 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] leading-relaxed text-text-muted shadow-[var(--shadow-sm)]">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
        <span>
          Entradas/Saídas somam a loja inteira e <strong className="font-semibold text-text">incluem transferências entre locais desta mesma loja</strong> —
          a Omie conta a saída do local de origem sem compensar com a entrada no destino, então um dia com
          transferência grande infla este número mesmo sem o produto ter saído de verdade do estoque. Pra ver
          cada movimento com o local e o documento, use a aba <strong className="font-semibold text-text">Movimentos</strong>.
        </span>
      </div>
      )}

      {!proprio && MOSTRAR_VALORES && temCmcAbsurdo && (
        <div className="flex items-start gap-2.5 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] leading-relaxed text-text-muted shadow-[var(--shadow-sm)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <span>
            <strong className="font-semibold text-text">CMC suspeito detectado</strong> — um ou mais produtos têm custo médio
            unitário acima de R$ {CMC_ALERTA_UNITARIO.toLocaleString('pt-BR')} no Omie.
          </span>
        </div>
      )}

      {MOSTRAR_VALORES && semCmc > 0 && (
        <div className="flex items-start gap-2.5 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] leading-relaxed text-text-muted shadow-[var(--shadow-sm)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <span>{semCmc} produto{semCmc > 1 ? 's' : ''} sem CMC nesta página.</span>
        </div>
      )}

      {!proprio && (
      <div className="flex items-start gap-2.5 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] leading-relaxed text-text-muted shadow-[var(--shadow-sm)]">
        <Info className="mt-0.5 size-3.5 shrink-0 text-warn" />
        <p>
          <strong className="font-semibold text-text">Valores em R$ ocultos por enquanto</strong> (o custo do Omie está furado). A tela mostra só a
          quantidade movimentada, agregada por produto/dia.
        </p>
      </div>
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
            hint="Ajuste o período ou o produto. O histórico cobre desde julho de 2025."
          />
        }
      />

      {(page > 1 || temProxima) && <Paginacao basePath="/movimentacoes" page={page} temProxima={temProxima} />}
    </div>
  )
}
