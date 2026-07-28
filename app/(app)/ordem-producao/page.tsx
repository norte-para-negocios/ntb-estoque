import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao, isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SyncButton } from '@/components/SyncButton'
import { OrdemProducaoLista } from '@/components/ordem-producao/OrdemProducaoLista'
import { CriarOrdemProducao } from '@/components/ordem-producao/CriarOrdemProducao'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { btnClass } from '@/components/ui-kit/Button'
import { isOpConcluida, opStatus } from '@/lib/op-status'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { Factory, Download, ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import {
  complementarOrdensProducao,
  limiteJanelaQuente,
  buscarFrioTudo,
  contarOrdensProducaoAntigas,
} from '@/lib/historico-contabo'

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
    familia?: string
    op_concluido?: string
    op_status?: string
    local?: string
    ord?: string
    page?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()

  const supabase = await createClient()

  // Permissoes de acao por botao. Sync (Atualizar agora) virou admin-only.
  const podeSync = await isAdmin()
  const podeCriar = await requirePermissao(lojaId, 'Ordens de Producao - Criar')
  const podeEditar = await requirePermissao(lojaId, 'Ordens de Producao - Editar')
  const podeExcluir = await requirePermissao(lojaId, 'Ordens de Producao - Excluir')
  const podeConcluir = await requirePermissao(lojaId, 'Ordens de Producao - Concluir')
  const podeReverter = await requirePermissao(lojaId, 'Ordens de Producao - Reverter')

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
  const chipsPeriodo = chipsPeriodoPadrao({ value: '', label: 'Este mês', dataIni: primeiroDiaMes, dataFim: ultimoDiaMes })

  // Filtro de status: concluida (S/N) ou status granular (prevista/pendente/atrasada).
  // op_concluido S/N mantido por compatibilidade; op_status e o novo filtro de 4 estados.
  const filtraConclusao = sp.op_concluido === 'S' || sp.op_concluido === 'N'
  // Filtro por status granular (prevista/pendente/atrasada) via comparacao de data no banco.
  // Nao ha coluna de status; derivamos da comparacao de identificacao_d_dt_previsao com hoje.
  const filtroStatus = sp.op_status ?? ''

  // Familias distintas (produtos com ordens) para o select (melhor esforco).
  const { data: produtosFamilia } = await supabase
    .from('produtos')
    .select('descricao_familia')
    .eq('loja_id', lojaId)
    .not('descricao_familia', 'is', null)
  const familias = [
    ...new Set((produtosFamilia ?? []).map((p) => p.descricao_familia).filter(Boolean)),
  ].sort() as string[]

  // Filtros op_produto / tipo_produto / familia: as colunas produto_* em
  // ordens_producao sao 100% NULL. Cruzamos via a tabela produtos para obter os
  // codigo_produto e filtramos por identificacao_n_cod_produto (campo preenchido).
  const tiposProdutoArr = valoresMulti(sp.tipo_produto)
  const familiasArr = valoresMulti(sp.familia)
  let codigosFiltro: number[] | null = null
  if (sp.op_produto || tiposProdutoArr.length || familiasArr.length) {
    let prodQuery = supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', lojaId)
    if (sp.op_produto) {
      const termo = escapeIlikeOr(sp.op_produto)
      prodQuery = prodQuery.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
    }
    if (tiposProdutoArr.length) prodQuery = prodQuery.in('tipo_item', tiposProdutoArr)
    if (familiasArr.length) prodQuery = prodQuery.in('descricao_familia', familiasArr)
    const { data: prods } = await prodQuery
    codigosFiltro = [
      ...new Set((prods ?? []).map((p) => p.codigo_produto).filter((v): v is number => v != null)),
    ]
  }

  type OPRow = {
    id: number
    identificacao_n_cod_op: number
    num_ordem: string | null
    identificacao_c_num_op: string | null
    identificacao_n_cod_produto: number | null
    identificacao_n_qtde: number | null
    identificacao_d_dt_previsao: string | null
    validade: string | null
    quantidade: number | null
    concluida: boolean | null
    dt_conclusao_real: string | null
  }

  const ord = sp.ord ?? ''
  const ordEmMemoria = ord === 'produto_az' || ord === 'produto_za'
  // So precisa buscar tudo em memoria para ordenar por NOME do produto (vem do
  // join, nao da query), ou quando o periodo cruza a janela quente (o Contabo
  // pode ter linhas no meio do intervalo, paginacao nativa nao e confiavel nesse caso).
  const precisaBuscarTudo = ordEmMemoria || dataInicio < limiteJanelaQuente()

  function baseQuery() {
    let q = supabase
      .from('ordens_producao')
      .select(
        'id, identificacao_n_cod_op, num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao, validade, quantidade, concluida, dt_conclusao_real'
      )
      .eq('loja_id', lojaId)
    if (filtraConclusao) q = q.eq('concluida', sp.op_concluido === 'S')
    // Filtro de status granular: prevista / pendente / atrasada / concluida.
    // "pendente" = data = hoje (nao concluida); "prevista" = data futura; "atrasada" = data passada.
    if (filtroStatus === 'concluida') {
      q = q.eq('concluida', true)
    } else if (filtroStatus === 'prevista') {
      q = q.eq('concluida', false).gt('identificacao_d_dt_previsao', hojeISO)
    } else if (filtroStatus === 'pendente') {
      q = q.eq('concluida', false).eq('identificacao_d_dt_previsao', hojeISO)
    } else if (filtroStatus === 'atrasada') {
      q = q.eq('concluida', false).lt('identificacao_d_dt_previsao', hojeISO)
    }
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
      const { data, error } = await baseQuery().range(off, off + LOTE - 1)
      // Achado real (auditoria de relatórios, 2026-07-26): um erro transitório
      // no meio da paginação (ex.: statement-timeout) era tratado igual a
      // "acabaram os dados" -- marca truncado (mesmo aviso já exibido pro
      // teto de MAX_LOTES) em vez de deixar o conjunto parecer completo.
      if (error) { console.error('ordem-producao: falha ao paginar OPs', error); truncado = true; break }
      const lote = (data ?? []) as OPRow[]
      if (!lote.length) break
      todas.push(...lote)
      if (lote.length < LOTE) break
      if (i === MAX_LOTES - 1) truncado = true // saiu pelo teto com lote cheio: ha mais
    }
    const completouComContabo = dataInicio < limiteJanelaQuente()
    // campo: 'previsao' -- o filtro de periodo desta tela e sobre
    // identificacao_d_dt_previsao (data planejada), nao dt_conclusao_real (default
    // do helper). Achado real 2026-07-19: sem isso, o complemento frio filtrava
    // pela data de conclusao, entao OPs nao concluidas do Contabo nunca entravam
    // com periodo aplicado e OPs concluidas apareciam no periodo errado.
    let filtradas = completouComContabo
      ? await complementarOrdensProducao(todas, { lojaId, dataInicio, dataFinal, campo: 'previsao' })
      : todas
    prodMap = await resolverProdutos(filtradas)
    if (ordEmMemoria) {
      const dir = ord === 'produto_za' ? -1 : 1
      filtradas = [...filtradas].sort((a, b) => {
        const na = (prodMap.get(a.identificacao_n_cod_produto as number)?.descricao ?? '').toLowerCase()
        const nb = (prodMap.get(b.identificacao_n_cod_produto as number)?.descricao ?? '').toLowerCase()
        return na.localeCompare(nb, 'pt-BR') * dir
      })
    } else if (completouComContabo) {
      // As linhas do Contabo entram no final do array (fora da ordenacao do banco
      // que so cobriu "todas") -- reordena em memoria seguindo o mesmo criterio de `ord`.
      filtradas = [...filtradas].sort((a, b) => {
        if (ord === 'codigo') {
          const va = a.identificacao_n_cod_produto, vb = b.identificacao_n_cod_produto
          if (va == null) return 1
          if (vb == null) return -1
          return va - vb
        }
        if (ord === 'qtd_desc' || ord === 'qtd_asc') {
          const va = a.identificacao_n_qtde, vb = b.identificacao_n_qtde
          if (va == null) return 1
          if (vb == null) return -1
          return ord === 'qtd_desc' ? vb - va : va - vb
        }
        if (ord === 'validade_asc' || ord === 'validade_desc') {
          const va = a.validade, vb = b.validade
          if (va == null) return 1
          if (vb == null) return -1
          return ord === 'validade_desc' ? (va < vb ? 1 : -1) : va < vb ? -1 : 1
        }
        return 0
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

  // Ingredientes da malha: busca full_object so para as OPs da pagina atual
  type Ingrediente = { cod: number; nome: string; unidade: string; qtd: number }
  const { data: opsFullObj } = await supabase
    .from('ordens_producao')
    .select('id, full_object')
    .in('id', ordens.map((o) => o.id))
  const fullObjMap = new Map(
    (opsFullObj ?? []).map((o) => [
      o.id as number,
      (o.full_object as { itensDetalhes?: { nIdProdutoMalha: number; nQtde: number }[] | null } | null)
        ?.itensDetalhes ?? [],
    ])
  )
  const ingCodesSet = new Set<number>()
  for (const items of fullObjMap.values()) {
    for (const i of items) if (i.nIdProdutoMalha) ingCodesSet.add(i.nIdProdutoMalha)
  }
  const { data: ingProds } = ingCodesSet.size
    ? await supabase
        .from('produtos')
        .select('codigo_produto, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', [...ingCodesSet])
    : { data: [] as { codigo_produto: number; descricao: string; unidade: string }[] }
  const ingProdMap = new Map((ingProds ?? []).map((p) => [p.codigo_produto, p]))
  const ingredientesMap = new Map<number, Ingrediente[]>()
  for (const [opId, items] of fullObjMap) {
    const ings: Ingrediente[] = items
      .filter((i) => i.nIdProdutoMalha)
      .map((i) => {
        const p = ingProdMap.get(i.nIdProdutoMalha)
        return {
          cod: i.nIdProdutoMalha,
          nome: formatarNomeProduto(p?.descricao) || `#${i.nIdProdutoMalha}`,
          unidade: p?.unidade ?? '',
          qtd: Number(i.nQtde),
        }
      })
    if (ings.length) ingredientesMap.set(opId, ings)
  }

  // Locais de estoque ativos da loja para o seletor de "Criar OP"
  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .neq('inativo', 'S')
    .order('descricao')

  // Totais por status granular: ignora filtro de status/conclusao para mostrar todos os contadores.
  // head:true = so o count, sem trazer linhas (barato) -- so vale dentro da janela
  // quente. Quando o periodo cruza pra fora dela, o Supabase sozinho SUBESTIMA os
  // contadores (achado real: "Atrasadas" da loja 3 mostrava 465 quando o total
  // combinado Supabase+Contabo era 602 -- 137 OPs antigas ficavam de fora
  // silenciosamente). Nesse caso busca as linhas (paginado, sem confiar no default
  // de 1000 linhas do PostgREST) e completa com o Contabo antes de contar em JS.
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

  type TotalRow = { id: number; identificacao_n_cod_op: number; concluida: boolean | null; identificacao_d_dt_previsao: string | null }
  let totConcluidasFinal: number
  let totPrevistasFinal: number
  let totPendentesFinal: number
  let totAtrasadasFinal: number
  // true quando o endpoint do Contabo devolveu MENOS linhas do que o count(*) real
  // do periodo -- o endpoint de linhas (diferente do count=true) tem um teto de
  // paginacao proprio (~2000 linhas, sem parametro de offset/page pra continuar).
  // Nesse caso os contadores abaixo sao um PISO (podem faltar OPs antigas demais
  // pra caber no lote), nao o valor exato -- avisamos em vez de mostrar errado.
  let totaisParciais = false

  if (dataInicio < limiteJanelaQuente()) {
    function totaisRowsQuery() {
      let q = supabase
        .from('ordens_producao')
        .select('id, identificacao_n_cod_op, concluida, identificacao_d_dt_previsao')
        .eq('loja_id', lojaId)
      if (dataInicio) q = q.gte('identificacao_d_dt_previsao', dataInicio)
      if (dataFinal) q = q.lte('identificacao_d_dt_previsao', dataFinal)
      if (sp.ordem_producao) q = q.ilike('identificacao_c_num_op', `%${escapeIlike(sp.ordem_producao)}%`)
      if (codigosFiltro !== null) {
        q = q.in('identificacao_n_cod_produto', codigosFiltro.length ? codigosFiltro : [-1])
      }
      // .order('id') e OBRIGATORIO pra paginar com .range() de forma estavel --
      // sem ordem explicita, o Postgres pode devolver a mesma linha em 2 paginas
      // e pular outra (achado real: testado direto, sem order() a mesma consulta
      // trouxe 15620 linhas com so 14276 ids UNICOS -- 1344 duplicadas e outras
      // tantas nunca lidas. Com order('id') bateu 15620 linhas = 15620 ids unicos).
      return q.order('id', { ascending: true })
    }
    // Busca em lotes de .range() -- um .select() sem .range() cai no teto padrao
    // de 1000 linhas do PostgREST (confirmado: count exato via head:true bate
    // 14977, mas .data vem com so 1000 linhas sem paginar).
    const totaisQuentes: TotalRow[] = []
    const LOTE = 1000
    const MAX_LOTES = 200 // teto de seguranca (~200k OPs) pra nao travar o SSR
    for (let off = 0, i = 0; i < MAX_LOTES; off += LOTE, i++) {
      const { data, error } = await totaisRowsQuery().range(off, off + LOTE - 1)
      // Mesmo achado do loop de `todas` acima: erro transitório no meio da
      // paginação virava "acabaram os dados" em silêncio.
      if (error) { console.error('ordem-producao: falha ao paginar contadores', error); totaisParciais = true; break }
      const lote = (data ?? []) as TotalRow[]
      if (!lote.length) break
      totaisQuentes.push(...lote)
      if (lote.length < LOTE) break
    }
    // Busca o lado frio direto (nao via complementarOrdensProducao) pra poder
    // comparar o tamanho bruto devolvido contra o count(*) real do periodo.
    // O endpoint de linhas do Contabo tem teto proprio (~2000 linhas) mas
    // agora aceita `offset` (achado 2026-07-19: sem paginar, lojas com muito
    // volume vinham cortadas em silencio) -- buscarFrioTudo pagina ate trazer
    // tudo. totaisParciais fica so como cinto-de-seguranca.
    // previsao_inicio/previsao_final (nao data_inicio/data_final): achado real
    // 2026-07-19 -- o servidor do Contabo filtra data_inicio/data_final contra
    // dt_conclusao_real (usado por outro consumidor, lib/resumo-dia.ts). Os
    // contadores desta tela sao sobre identificacao_d_dt_previsao (mesmo campo
    // usado no filtro do lado quente, linhas acima) -- usando o campo errado,
    // toda OP nao concluida do Contabo (sem dt_conclusao_real) sumia sempre que
    // um periodo era aplicado, e OPs concluidas contavam no periodo de conclusao
    // em vez do periodo planejado (ex: Concluidas da loja 2 mostrava 53140 em vez
    // de ~60230 no teste desde-o-inicio).
    const [friasRaw, friasTotalReal] = await Promise.all([
      buscarFrioTudo<TotalRow>('/ordens_producao', { loja_id: lojaId, previsao_inicio: dataInicio, previsao_final: dataFinal }, 2000),
      contarOrdensProducaoAntigas({ lojaId, dataInicio, dataFinal, campo: 'previsao' }),
    ])
    if (friasRaw.length < friasTotalReal) totaisParciais = true
    const vistosQuentes = new Set(totaisQuentes.map((r) => r.identificacao_n_cod_op))
    const totaisCompletos = [...totaisQuentes, ...friasRaw.filter((r) => !vistosQuentes.has(r.identificacao_n_cod_op))]
    totConcluidasFinal = totaisCompletos.filter((o) => o.concluida).length
    // nulls excluidos explicitamente (nao coalescer pra '' -- '' < qualquer data
    // contaria erroneamente como atrasada): espelha o gte/lte do banco, que tambem
    // nao casa NULL.
    totPrevistasFinal = totaisCompletos.filter(
      (o) => !o.concluida && o.identificacao_d_dt_previsao != null && o.identificacao_d_dt_previsao > hojeISO
    ).length
    totPendentesFinal = totaisCompletos.filter(
      (o) => !o.concluida && o.identificacao_d_dt_previsao === hojeISO
    ).length
    totAtrasadasFinal = totaisCompletos.filter(
      (o) => !o.concluida && o.identificacao_d_dt_previsao != null && o.identificacao_d_dt_previsao < hojeISO
    ).length
  } else {
    const [
      { count: totConcluidas },
      { count: totPrevistas },
      { count: totPendentes },
      { count: totAtrasadas },
    ] = await Promise.all([
      totaisBase().eq('concluida', true),
      totaisBase().eq('concluida', false).gt('identificacao_d_dt_previsao', hojeISO),
      totaisBase().eq('concluida', false).eq('identificacao_d_dt_previsao', hojeISO),
      totaisBase().eq('concluida', false).lt('identificacao_d_dt_previsao', hojeISO),
    ])
    totConcluidasFinal = totConcluidas ?? 0
    totPrevistasFinal = totPrevistas ?? 0
    totPendentesFinal = totPendentes ?? 0
    totAtrasadasFinal = totAtrasadas ?? 0
  }

  const exportParams = new URLSearchParams()
  // Usa o periodo efetivo (mes corrente por default) para o CSV bater com a tela.
  exportParams.set('data_inicio', dataInicio)
  exportParams.set('data_final', dataFinal)
  if (sp.ordem_producao) exportParams.set('ordem_producao', sp.ordem_producao)
  if (sp.op_produto) exportParams.set('op_produto', sp.op_produto)
  if (sp.tipo_produto) exportParams.set('tipo_produto', sp.tipo_produto)
  if (sp.familia) exportParams.set('familia', sp.familia)
  if (sp.op_concluido) exportParams.set('op_concluido', sp.op_concluido)
  if (sp.op_status) exportParams.set('op_status', sp.op_status)

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
    { tipo: 'multi-select', nome: 'tipo_produto', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
    {
      tipo: 'multi-select',
      nome: 'familia',
      label: 'Família',
      opcoes: familias.map((f) => ({ value: f, label: f })),
    },
    {
      tipo: 'select',
      nome: 'local',
      label: 'Local de produção',
      opcoes: (locais ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
    {
      tipo: 'select',
      nome: 'op_status',
      label: 'Status',
      opcoes: [
        { value: '', label: 'Todos' },
        { value: 'prevista', label: 'Prevista' },
        { value: 'pendente', label: 'Pendente' },
        { value: 'atrasada', label: 'Atrasada' },
        { value: 'concluida', label: 'Concluída' },
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
      <ListaHeader>
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
                  familia: sp.familia ?? '',
                  op_status: sp.op_status ?? '',
                  local: sp.local ?? '',
                  ord: sp.ord ?? '',
                }}
                persistirEm="/ordem-producao"
              />
              <a
                href={`/ordem-producao/export?${exportParams.toString()}`}
                className={btnClass('outline')}
              >
                <Download className="size-4" /> Excel
              </a>
              <a
                href={`/ordem-producao/programacao?mes=${dataInicio.slice(0, 7)}${sp.local ? `&local=${sp.local}` : ''}${sp.tipo_produto ? `&tipo_produto=${encodeURIComponent(sp.tipo_produto)}` : ''}`}
                target="_blank" rel="noopener noreferrer" className={btnClass('outline')}
                title="Matriz produto x dia do mês, com espaço para anotar o produzido"
              >
                <Factory className="size-4" /> Imprimir Programação
              </a>
              <a
                href={`/ordem-producao/programacao?mes=${dataInicio.slice(0, 7)}&atraso=1${sp.local ? `&local=${sp.local}` : ''}${sp.tipo_produto ? `&tipo_produto=${encodeURIComponent(sp.tipo_produto)}` : ''}`}
                target="_blank" rel="noopener noreferrer" className={btnClass('outline')}
                title="Só as ordens ainda não concluídas com previsão já vencida"
              >
                <Factory className="size-4" /> Imprimir Atrasadas
              </a>
              {podeSync && <SyncButton endpoint="/api/sync/ordens-producao" label="Atualizar agora" />}
              {podeCriar && <CriarOrdemProducao locais={locais ?? []} />}
            </>
          }
        />
        <ChipsStatus
          basePath="/ordem-producao"
          param="op_status"
          opcoes={[
            { value: '', label: 'Todas' },
            { value: 'prevista', label: 'Previstas', count: totPrevistasFinal },
            { value: 'pendente', label: 'Pendentes', count: totPendentesFinal },
            { value: 'atrasada', label: 'Atrasadas', count: totAtrasadasFinal },
            { value: 'concluida', label: 'Concluídas', count: totConcluidasFinal },
          ]}
        />
        <ChipsPeriodo basePath="/ordem-producao" opcoes={chipsPeriodo} />
        <ChipsFiltrosAtivos
          basePath="/ordem-producao"
          campos={campos}
          naoMostrar={['data_inicio', 'data_final', 'ord', 'op_concluido', 'op_status']}
          persistirEm="/ordem-producao"
        />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13px] text-text-muted">Período: {fmtDataBR(dataInicio)} a {fmtDataBR(dataFinal)}</span>
      </div>

      {truncado && (
        <p className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-text-muted">
          Há muitas ordens. Mostrando uma parte. Use o filtro de data para refinar e ver tudo.
        </p>
      )}

      {totaisParciais && (
        <p className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-text-muted">
          Período muito longo: os contadores acima (Previstas/Pendentes/Atrasadas/Concluídas) podem estar
          abaixo do real. Use um período mais curto para ver os números exatos.
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
              // Concluida: mostra a data REAL de conclusao (dt_conclusao_real), nao a
              // planejada -- senao uma OP concluida em dia diferente do previsto mostra
              // a data errada. Nao concluida: data agendada (identificacao_d_dt_previsao),
              // nao a de inclusao, que na recorrencia vem como hoje (bug que o cliente viu).
              data: fmtDataBR(op.dt_conclusao_real || op.identificacao_d_dt_previsao),
              concluida: isOpConcluida(op),
              status: opStatus(op, hojeISO),
              // Cada acao da OP atras da sua permissao (calculada no servidor acima).
              podeEditar,
              podeExcluir,
              podeConcluir,
              podeReverter,
              ingredientes: ingredientesMap.get(op.id) ?? [],
            }
          })
          const cabecalhoDesktop = (
            <>
              <th className="w-32">OP</th>
              <th className="w-36 !text-center">Data</th>
              <th className="w-28">Status</th>
              <th>
                <Link href={ordHref(ord === 'produto_az' ? 'produto_za' : 'produto_az')} className="inline-flex items-center gap-1 hover:text-text">
                  Produto {setaIcone('produto_az', 'produto_za')}
                </Link>
              </th>
              <th className="w-28 !text-center">
                <Link href={ordHref(ord === 'qtd_asc' ? 'qtd_desc' : 'qtd_asc')} className="inline-flex items-center justify-center gap-1 hover:text-text">
                  Qtd OP {setaIcone('qtd_asc', 'qtd_desc')}
                </Link>
              </th>
              <th className="w-36 !text-center">
                <Link href={ordHref(ord === 'validade_asc' ? 'validade_desc' : 'validade_asc')} className="inline-flex items-center justify-center gap-1 hover:text-text">
                  Validade {setaIcone('validade_asc', 'validade_desc')}
                </Link>
              </th>
              <th className="w-28 !text-center">Quantidade</th>
              <th className="w-36"></th>
            </>
          )
          return (
            <OrdemProducaoLista
              linhas={linhas}
              podeConcluir={podeConcluir}
              podeReverter={podeReverter}
              cabecalhoDesktop={cabecalhoDesktop}
            />
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
