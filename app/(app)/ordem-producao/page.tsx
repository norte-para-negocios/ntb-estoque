import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SyncButton } from '@/components/SyncButton'
import { OrdemProducaoRow, OrdemProducaoCard } from '@/components/ordem-producao/OrdemProducaoRow'
import { CriarOrdemProducao } from '@/components/ordem-producao/CriarOrdemProducao'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { btnClass } from '@/components/ui-kit/Button'
import { isOpConcluida, opStatus } from '@/lib/op-status'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { Factory, Download, ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react'

const POR_PAGINA = 50

// Converte a data normalizada do banco (YYYY-MM-DD) para DD/MM/AAAA. E uma data
// pura (sem hora), entao nao tem questao de fuso.
function fmtDataBR(d: string | null): string | null {
  if (!d) return null
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

export default async function OrdemProducaoPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    ordem_producao?: string
    op_produto?: string
    tipo_produto?: string
    op_concluido?: string
    ord?: string
    page?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()

  const supabase = await createClient()

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)

  // Filtro de periodo: default no mes corrente quando o usuario nao informa.
  // Atende o pedido do cliente (abrir no mes atual) e reduz o volume da listagem.
  // OBS de produto: OPs sem identificacao_d_dt_previsao (sem data agendada) ficam
  // fora do filtro de periodo (gte/lte nao casam NULL). Confirmar com o Ramon se
  // precisa de um modo "sem data" para nao esconder pendentes nao agendadas.
  const hojeISO = hojeBahiaISO() // YYYY-MM-DD em America/Bahia
  const [anoAtual, mesAtual] = hojeISO.split('-').map(Number)
  const primeiroDiaMes = `${hojeISO.slice(0, 7)}-01`
  const ultimoDiaMes = `${hojeISO.slice(0, 7)}-${String(new Date(anoAtual, mesAtual, 0).getDate()).padStart(2, '0')}`
  const dataInicio = sp.data_inicio ?? primeiroDiaMes
  const dataFinal = sp.data_final ?? ultimoDiaMes

  // Filtro de conclusao direto no banco pela coluna `concluida` (migration 012).
  // Antes dependia do full_object aninhado (sem filtro no PostgREST) e buscava
  // tudo em memoria em lotes; agora e um filtro simples com paginacao normal.
  const filtraConclusao = sp.op_concluido === 'S' || sp.op_concluido === 'N'

  // Filtros op_produto / tipo_produto: as colunas produto_* em ordens_producao
  // sao 100% NULL. Cruzamos via a tabela produtos para obter os codigo_produto
  // e filtramos por identificacao_n_cod_produto (campo preenchido).
  let codigosFiltro: number[] | null = null
  if (sp.op_produto || sp.tipo_produto) {
    let prodQuery = supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', lojaId)
    if (sp.op_produto) {
      const termo = escapeIlikeOr(sp.op_produto)
      prodQuery = prodQuery.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
    }
    if (sp.tipo_produto) prodQuery = prodQuery.eq('tipo_item', sp.tipo_produto)
    const { data: prods } = await prodQuery
    codigosFiltro = [
      ...new Set((prods ?? []).map((p) => p.codigo_produto).filter((v): v is number => v != null)),
    ]
  }

  type OPRow = {
    id: number
    num_ordem: string | null
    identificacao_c_num_op: string | null
    identificacao_n_cod_produto: number | null
    identificacao_n_qtde: number | null
    identificacao_d_dt_previsao: string | null
    validade: string | null
    quantidade: number | null
    concluida: boolean | null
  }

  const ord = sp.ord ?? ''
  const ordEmMemoria = ord === 'produto_az' || ord === 'produto_za'
  // So precisa buscar tudo em memoria para ordenar por NOME do produto (vem do
  // join, nao da query). A conclusao agora filtra no banco (coluna concluida).
  const precisaBuscarTudo = ordEmMemoria

  function baseQuery() {
    let q = supabase
      .from('ordens_producao')
      .select(
        'id, num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao, validade, quantidade, concluida'
      )
      .eq('loja_id', lojaId)
    if (filtraConclusao) q = q.eq('concluida', sp.op_concluido === 'S')
    if (dataInicio) q = q.gte('identificacao_d_dt_previsao', dataInicio)
    if (dataFinal) q = q.lte('identificacao_d_dt_previsao', dataFinal)
    if (sp.ordem_producao) q = q.ilike('identificacao_c_num_op', `%${escapeIlike(sp.ordem_producao)}%`)
    if (codigosFiltro !== null) {
      q = q.in('identificacao_n_cod_produto', codigosFiltro.length ? codigosFiltro : [-1])
    }
    // Ordenacao no banco (qtd/validade/codigo do produto). produto_az/za sao
    // reordenados em memoria depois. O desempate por id mantem a janela .range
    // estavel quando a chave de ordem nao e unica.
    // nullsFirst: false = OPs sem o campo (validade/qtde/codigo nulos) sempre por ultimo.
    if (ord === 'codigo') q = q.order('identificacao_n_cod_produto', { ascending: true, nullsFirst: false })
    else if (ord === 'qtd_desc') q = q.order('identificacao_n_qtde', { ascending: false, nullsFirst: false })
    else if (ord === 'qtd_asc') q = q.order('identificacao_n_qtde', { ascending: true, nullsFirst: false })
    else if (ord === 'validade_asc') q = q.order('validade', { ascending: true, nullsFirst: false })
    else if (ord === 'validade_desc') q = q.order('validade', { ascending: false, nullsFirst: false })
    else q = q.order('updated_at', { ascending: false })
    return q.order('id', { ascending: false })
  }

  // Resolve descricao/unidade dos produtos de um conjunto de linhas.
  async function resolverProdutos(rows: OPRow[]) {
    const cods = [...new Set(rows.map((o) => o.identificacao_n_cod_produto).filter(Boolean))]
    const { data } = cods.length
      ? await supabase
          .from('produtos')
          .select('codigo_produto, descricao, unidade')
          .eq('loja_id', lojaId)
          .in('codigo_produto', cods)
      : { data: [] }
    return new Map((data ?? []).map((p) => [p.codigo_produto, p]))
  }

  let ordens: OPRow[]
  let temProxima: boolean
  let prodMap: Awaited<ReturnType<typeof resolverProdutos>>
  let truncado = false // conjunto bateu no teto de lotes (so sem filtro de data em loja enorme)

  if (precisaBuscarTudo) {
    // Busca o conjunto completo (filtrado) em lotes para filtrar conclusao e/ou
    // ordenar por nome do produto em memoria, depois pagina. Com o filtro padrao
    // de mes corrente, esse conjunto e pequeno.
    const todas: OPRow[] = []
    const LOTE = 1000
    const MAX_LOTES = 60 // teto de seguranca (~60k OPs) para nao travar o SSR
    for (let off = 0, i = 0; i < MAX_LOTES; off += LOTE, i++) {
      const { data } = await baseQuery().range(off, off + LOTE - 1)
      const lote = (data ?? []) as OPRow[]
      if (!lote.length) break
      todas.push(...lote)
      if (lote.length < LOTE) break
      if (i === MAX_LOTES - 1) truncado = true // saiu pelo teto com lote cheio: ha mais
    }
    let filtradas = todas
    prodMap = await resolverProdutos(filtradas)
    if (ordEmMemoria) {
      const dir = ord === 'produto_za' ? -1 : 1
      filtradas = [...filtradas].sort((a, b) => {
        const na = (prodMap.get(a.identificacao_n_cod_produto as number)?.descricao ?? '').toLowerCase()
        const nb = (prodMap.get(b.identificacao_n_cod_produto as number)?.descricao ?? '').toLowerCase()
        return na.localeCompare(nb, 'pt-BR') * dir
      })
    }
    temProxima = filtradas.length > page * POR_PAGINA
    ordens = filtradas.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)
  } else {
    // .range busca POR_PAGINA+1 de proposito: a linha extra detecta a proxima pagina.
    const { data } = await baseQuery().range((page - 1) * POR_PAGINA, page * POR_PAGINA)
    const ordensRaw = (data ?? []) as OPRow[]
    temProxima = ordensRaw.length > POR_PAGINA
    ordens = temProxima ? ordensRaw.slice(0, POR_PAGINA) : ordensRaw
    prodMap = await resolverProdutos(ordens)
  }

  // Locais de estoque ativos da loja para o seletor de "Criar OP"
  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .neq('inativo', 'S')
    .order('descricao')

  // Totais por status (Pendentes/Concluidas) do conjunto filtrado, IGNORANDO o
  // filtro de conclusao: assim o usuario ve quantas ha de cada, mesmo filtrando
  // por uma. head:true = so o count, nao traz linhas (barato).
  const totaisBase = () => {
    let q = supabase
      .from('ordens_producao')
      .select('id', { count: 'exact', head: true })
      .eq('loja_id', lojaId)
    if (dataInicio) q = q.gte('identificacao_d_dt_previsao', dataInicio)
    if (dataFinal) q = q.lte('identificacao_d_dt_previsao', dataFinal)
    if (sp.ordem_producao) q = q.ilike('identificacao_c_num_op', `%${escapeIlike(sp.ordem_producao)}%`)
    if (codigosFiltro !== null) {
      q = q.in('identificacao_n_cod_produto', codigosFiltro.length ? codigosFiltro : [-1])
    }
    return q
  }
  const [{ count: totConcluidas }, { count: totPendentes }] = await Promise.all([
    totaisBase().eq('concluida', true),
    totaisBase().eq('concluida', false),
  ])

  const exportParams = new URLSearchParams()
  // Usa o periodo efetivo (mes corrente por default) para o CSV bater com a tela.
  exportParams.set('data_inicio', dataInicio)
  exportParams.set('data_final', dataFinal)
  if (sp.ordem_producao) exportParams.set('ordem_producao', sp.ordem_producao)
  if (sp.op_produto) exportParams.set('op_produto', sp.op_produto)
  if (sp.tipo_produto) exportParams.set('tipo_produto', sp.tipo_produto)
  if (sp.op_concluido) exportParams.set('op_concluido', sp.op_concluido)

  // Ordenacao clicando no cabecalho da tabela (mantem os filtros atuais).
  const ordHref = (novoOrd: string) => {
    const s = new URLSearchParams(exportParams.toString())
    s.set('ord', novoOrd)
    return `/ordem-producao?${s.toString()}`
  }
  // Indicador de ordenacao SEMPRE visivel no cabecalho (mostra que da pra clicar):
  // setinha dupla apagada quando inativo, seta cheia na direcao quando ativo.
  const setaIcone = (asc: string, desc: string) => {
    if (ord === asc) return <ArrowUp className="size-3.5 text-brand" />
    if (ord === desc) return <ArrowDown className="size-3.5 text-brand" />
    return <ChevronsUpDown className="size-3.5 opacity-40" />
  }

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'ordem_producao', label: 'Ordem de produção' },
    { tipo: 'texto', nome: 'op_produto', label: 'Produto (código ou descrição)' },
    { tipo: 'select', nome: 'tipo_produto', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
    {
      tipo: 'select',
      nome: 'op_concluido',
      label: 'Status',
      opcoes: [
        { value: '', label: 'Todos' },
        { value: 'S', label: 'Concluída' },
        { value: 'N', label: 'Pendente' },
      ],
    },
    {
      tipo: 'select',
      nome: 'ord',
      label: 'Ordenar por',
      opcoes: [
        { value: 'produto_az', label: 'Produto A-Z' },
        { value: 'produto_za', label: 'Produto Z-A' },
        { value: 'codigo', label: 'Código do produto' },
        { value: 'qtd_desc', label: 'Maior quantidade' },
        { value: 'qtd_asc', label: 'Menor quantidade' },
        { value: 'validade_asc', label: 'Validade mais próxima' },
        { value: 'validade_desc', label: 'Validade mais distante' },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ordens de Produção"
        icon={Factory}
        actions={
          <>
            <FiltrosGaveta
              basePath="/ordem-producao"
              campos={campos}
              defaults={{
                data_inicio: dataInicio,
                data_final: dataFinal,
                ordem_producao: sp.ordem_producao ?? '',
                op_produto: sp.op_produto ?? '',
                tipo_produto: sp.tipo_produto ?? '',
                op_concluido: sp.op_concluido ?? '',
                ord: sp.ord ?? '',
              }}
            />
            <a
              href={`/ordem-producao/export?${exportParams.toString()}`}
              className={btnClass('outline')}
            >
              <Download className="size-4" /> Exportar
            </a>
            <SyncButton endpoint="/api/sync/ordens-producao" label="Atualizar agora" />
            <CriarOrdemProducao locais={locais ?? []} />
          </>
        }
      />

      <ChipsFiltrosAtivos
        basePath="/ordem-producao"
        campos={campos}
        naoMostrar={['data_inicio', 'data_final', 'ord']}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-text-muted">Período: {fmtDataBR(dataInicio)} a {fmtDataBR(dataFinal)}</span>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-[13px] text-text-muted">
          Pendentes <span className="num font-semibold text-warn">{totPendentes ?? 0}</span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-[13px] text-text-muted">
          Concluídas <span className="num font-semibold text-ok">{totConcluidas ?? 0}</span>
        </span>
      </div>

      {truncado && (
        <p className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-text-muted">
          Há muitas ordens. Mostrando uma parte. Use o filtro de data para refinar e ver tudo.
        </p>
      )}

      {ordens?.length ? (
        (() => {
          const linhas = ordens.map((op) => {
            const prod = prodMap.get(op.identificacao_n_cod_produto)
            return {
              id: op.id,
              numOP: op.identificacao_c_num_op || op.num_ordem || '-',
              produto: formatarNomeProduto(prod?.descricao) || `Produto ${op.identificacao_n_cod_produto}`,
              unidade: prod?.unidade || 'UN',
              qtdOP: op.identificacao_n_qtde,
              validade: op.validade,
              quantidade: op.quantidade,
              // data real/agendada da OP (identificacao_d_dt_previsao), nao a de
              // inclusao, que na recorrencia vem como hoje (bug que o cliente viu).
              data: fmtDataBR(op.identificacao_d_dt_previsao),
              concluida: isOpConcluida(op),
              status: opStatus(op, hojeISO),
            }
          })
          return (
            <>
              {/* Desktop: tabela com steppers na linha */}
              <div className="hidden lg:block">
                <DataTable>
                  <thead>
                    <tr>
                      <th className="w-40">OP</th>
                      <th className="w-28">Status</th>
                      <th>
                        <Link href={ordHref(ord === 'produto_az' ? 'produto_za' : 'produto_az')} className="inline-flex items-center gap-1 hover:text-text">
                          Produto {setaIcone('produto_az', 'produto_za')}
                        </Link>
                      </th>
                      <th className="w-28 !text-right">
                        <Link href={ordHref(ord === 'qtd_asc' ? 'qtd_desc' : 'qtd_asc')} className="inline-flex items-center justify-end gap-1 hover:text-text">
                          Qtd OP {setaIcone('qtd_asc', 'qtd_desc')}
                        </Link>
                      </th>
                      <th className="w-48 !text-center">
                        <Link href={ordHref(ord === 'validade_asc' ? 'validade_desc' : 'validade_asc')} className="inline-flex items-center justify-center gap-1 hover:text-text">
                          Validade {setaIcone('validade_asc', 'validade_desc')}
                        </Link>
                      </th>
                      <th className="w-40 !text-center">Quantidade</th>
                      <th className="w-44"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((op) => (
                      <OrdemProducaoRow key={op.id} op={op} />
                    ))}
                  </tbody>
                </DataTable>
              </div>
              {/* Mobile: cards empilhados com steppers em bloco vertical */}
              <div className="space-y-3 lg:hidden">
                {linhas.map((op) => (
                  <OrdemProducaoCard key={op.id} op={op} />
                ))}
              </div>
            </>
          )
        })()
      ) : (
        <EmptyState
          icon={Factory}
          title="Nenhuma ordem de produção"
          hint="Sincronize com o Omie."
        />
      )}

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/ordem-producao" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
