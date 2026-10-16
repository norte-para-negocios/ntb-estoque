import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ShoppingCart, Download } from 'lucide-react'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { DrillBreadcrumb } from '@/components/ui-kit/DrillBreadcrumb'
import { FiltrosNotas } from '@/components/nota-fiscal/FiltrosNotas'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { RankingBarras } from '@/components/faturamento/RankingBarras'
import { MatrizMensalTabela } from '@/components/faturamento/MatrizMensalTabela'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { ListaItensCompra } from '@/components/compras/ListaItensCompra'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { descreverCFOP } from '@/lib/cfop'
import { buscarFamilias } from '@/lib/actions/produto'
import { limiteJanelaQuenteNF } from '@/lib/historico-contabo'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { lerPeriodo } from '@/lib/faturamento-periodo'
import { filtrarPorNome, ordenarRanking, type LinhaRanking } from '@/lib/faturamento-itens'
import { rankingCompras, matrizCompras, type LinhaMesCompra } from '@/lib/relatorio-compras-visoes'
import {
  buscarItensNFFrio,
  filtrarItensCompras,
  agregarComprasTotal,
  agregarComprasMatriz,
  mapearComprasDetalhe,
  type ItemNFFrio,
  type MetaProdutoNF,
  type LinhaDetalheCompra,
} from '@/lib/relatorio-frio-nf'
import { parseDrill, hrefComDrill, SEM } from '@/lib/drill'
import { explicarRotulo } from '@/lib/rotulos-opacos'

// Situacao da nota. Pedido real do Ramon (reuniao 27/07, item #6): poder escolher
// Concluida/Pendente/Cancelada/Todas, com Concluida como padrao (sem status na URL).
const SITUACOES = [
  { value: '', label: 'Concluídas' },
  { value: 'MANIFESTADA', label: 'Manifestadas' },
  { value: 'PENDENTE', label: 'Pendentes' },
  { value: 'CANCELADA', label: 'Canceladas' },
  { value: 'TODAS', label: 'Todas' },
]

// Converte lista vazia em null (RPC trata null como "sem filtro"; array vazio
// com `= any()` não bateria com nada).
const arrOrNull = (a: string[]): string[] | null => (a.length ? a : null)

// Dimensões de abertura do relatório (espelham as planilhas do Ramon).
const DIMS = [
  { value: 'familia', label: 'Família', visao: 'Famílias' },
  { value: 'fornecedor', label: 'Fornecedor', visao: 'Fornecedores' },
  { value: 'produto', label: 'Produto', visao: 'Produtos' },
  { value: 'tipo', label: 'Tipo', visao: 'Tipos' },
  { value: 'cfop', label: 'CFOP', visao: 'CFOP' },
] as const

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))
const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`
// Periodo livre (a tela antiga aceitava qualquer intervalo); padrao = ano corrente.
const MAX_DIAS_COMPRAS = 3700

// Quantas linhas a tela mostra; o resto fica no "Baixar tudo".
const LIMITE_LINHAS = 200

type LinhaMatriz = LinhaMesCompra
type Sp = Record<string, string | undefined>

export default async function RelatorioComprasPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const lojaId = await getCurrentLojaId()
  // Relatório com R$ de compras é sensível: só gestores (admin global ou de loja).
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const dim = DIMS.some((d) => d.value === sp.dim) ? sp.dim! : 'familia'
  const mensal = sp.aba === 'mensal'
  const q = (sp.q ?? '').slice(0, 80)
  const sentido = sp.sentido === 'menos' ? 'menos' : 'mais'

  // Drill: qualquer dimensão -> produto -> itens. Cada par da trilha vira
  // filtro; a dimensão exibida desce a cadeia.
  const pares = parseDrill(sp.drill)
  const nivelItens = pares.some((p) => p.dim === 'produto') || (dim === 'produto' && pares.length > 0)
  const dimExibida = nivelItens ? null : pares.length > 0 ? 'produto' : dim

  // Periodo no padrao do Faturamento (ini/fim/mes); data_inicio/data_final de links antigos
  // continuam valendo. Sem nada na URL = ano corrente (padrao de sempre desta tela).
  const semPeriodo = !sp.ini && !sp.fim && !sp.mes && !sp.data_inicio && !sp.data_final
  const per = lerPeriodo(
    { ini: sp.ini ?? sp.data_inicio ?? (semPeriodo ? `${hoje.slice(0, 4)}-01-01` : undefined), fim: sp.fim ?? sp.data_final, mes: sp.mes },
    hoje,
    MAX_DIAS_COMPRAS,
  )
  const ini = per.ini
  const fim = per.fim
  const familiasSel = valoresMulti(sp.familia)
  const tiposSel = valoresMulti(sp.tipo)
  const cfopsSel = valoresMulti(sp.cfop)
  const fornecedor = sp.fornecedor || null
  const produto = sp.produto || null
  const localCod = sp.local && !Number.isNaN(Number(sp.local)) ? Number(sp.local) : null
  const statusSel = sp.status || 'CONCLUIDA'
  const filtros = {
    p_familias: arrOrNull(familiasSel),
    p_tipos: arrOrNull(tiposSel),
    p_fornecedor: fornecedor,
    p_cfops: arrOrNull(cfopsSel),
    p_produto: produto,
    p_local: localCod,
    p_status: statusSel,
  }
  // Pares da trilha sobrescrevem o filtro correspondente (drill restringe).
  const drillFiltros: Record<string, unknown> = {}
  for (const p of pares) {
    if (p.dim === 'familia') drillFiltros.p_familias = [p.rotulo === 'Sem classificação' ? SEM : p.rotulo]
    if (p.dim === 'tipo') drillFiltros.p_tipos = [p.rotulo === 'Sem classificação' ? SEM : p.rotulo]
    if (p.dim === 'fornecedor') drillFiltros.p_fornecedor = p.rotulo === 'Sem classificação' ? SEM : p.rotulo
    if (p.dim === 'cfop') drillFiltros.p_cfops = [p.rotulo === 'Sem classificação' ? SEM : p.rotulo]
    if (p.dim === 'produto' && p.rotulo !== SEM && p.rotulo !== 'Sem classificação') drillFiltros.p_produto = p.rotulo
  }
  const filtrosComDrill = { ...filtros, ...drillFiltros }

  const supabase = await createClient()
  // Achado real (auditoria de filtros/relatórios, Task 2, 2026-08-04): a migration
  // 097 (adiciona p_status às RPCs de Compras/Auditoria Fiscal) nunca tinha sido
  // aplicada em produção, mesmo com este código já chamando as RPCs com p_status
  // há dias -- toda chamada falhava com "function ... does not exist" e, como
  // ninguém aqui checava `error`, o total/matriz da janela quente (Supabase, os
  // ~90 dias mais recentes -- "os meses atuais" da queixa do Ramon) silenciosamente
  // virava 0/[] em TODAS as lojas, sobrando só o complemento frio (Contabo, mais
  // antigo). Corrigido aplicando a migration em produção (não é um bug de código
  // deste arquivo) -- mas o silêncio em si era real, então agora logamos e
  // avisamos na tela se uma dessas RPCs falhar de novo por qualquer motivo
  // (schema desalinhado, RPC renomeada, etc.), em vez de mostrar um total errado
  // sem nenhum sinal.
  const errosRpc: string[] = []
  function logErroRpc(fn: string, error: { message: string } | null) {
    if (!error) return
    errosRpc.push(fn)
    console.error(`relatorio-compras: RPC ${fn} falhou -- total pode estar sem a janela quente (Supabase)`, error.message)
  }

  // A matriz pode passar de 1000 linhas (PostgREST corta) em dim=produto: pagina.
  async function rpcTodos<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const PAGE = 1000
    const todos: T[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase.rpc(fn, args).range(p * PAGE, p * PAGE + PAGE - 1)
      if (error) logErroRpc(fn, error)
      if (error || !data?.length) break
      todos.push(...(data as T[]))
      if (data.length < PAGE) break
    }
    return todos
  }

  // A janela quente (Supabase) só cobre ~90 dias; a RPC nunca deve pedir algo
  // mais antigo (linhas já podadas), então clampa o início. A fatia antiga
  // (ini < corte) vem do Contabo, reagregada em JS abaixo.
  const corte = limiteJanelaQuenteNF()
  const iniRpc = ini < corte ? corte : ini

  type LinhaDim = { rotulo: string; valor: number }
  const [{ data: totalRows, error: erroTotal }, matrizRaw, { data: cfopDimRaw, error: erroDim }, fornRaw, fornOpcoesRaw] = await Promise.all([
    supabase.rpc('relatorio_compras_total', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, ...filtrosComDrill }),
    rpcTodos<LinhaMatriz>('relatorio_compras_matriz', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: dimExibida ?? 'produto', ...filtrosComDrill }),
    // Universo de CFOPs do período (sem os filtros de família/tipo/cfop), pra opções do filtro.
    supabase.rpc('relatorio_compras_dim', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: 'cfop', p_status: statusSel }),
    // Fornecedores do recorte (cartões "fornecedores" e "Maior fornecedor").
    rpcTodos<LinhaDim>('relatorio_compras_dim', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: 'fornecedor', ...filtrosComDrill }),
    // Opções do filtro de fornecedor: todos do período na situação escolhida.
    rpcTodos<LinhaDim>('relatorio_compras_dim', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: 'fornecedor', p_status: statusSel }),
  ])
  logErroRpc('relatorio_compras_total', erroTotal)
  logErroRpc('relatorio_compras_dim', erroDim)
  const fornLinhas: LinhaMatriz[] = fornRaw.map((r) => ({ rotulo: r.rotulo, mes: '', valor: Number(r.valor) || 0 }))
  const fornNomes = new Set(fornOpcoesRaw.map((r) => r.rotulo))
  let total = Number((totalRows as { valor: number }[] | null)?.[0]?.valor ?? 0)
  let nNotas = Number((totalRows as { n_notas: number }[] | null)?.[0]?.n_notas ?? 0)

  // Complemento frio (Contabo) para o pedaço [ini, corte). Reaproveita a
  // reagregação em JS que espelha a RPC (lib/relatorio-frio-nf.ts).
  // filtrados/meta ficam acessíveis fora do if pro nível de itens reusar.
  let filtrados: ItemNFFrio[] = []
  let meta: MetaProdutoNF = new Map()
  if (ini < corte) {
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    // Achado real: se o período pedido termina antes do corte (fim < corteExcl —
    // ex.: um recorte todo dentro do histórico frio), usar corteExcl fixo aqui
    // buscava dado a mais no Contabo (até o corte, não até `fim`), inflando o
    // total. Trava no menor dos dois.
    const dataFinalFria = fim < corteExcl ? fim : corteExcl

    // O Supabase corta em 1000 linhas por padrão (sem erro) -- pagina até esgotar
    // (achado real: lojas com >1000 produtos perdiam o resto do catálogo aqui,
    // igual ao que já era feito no export/route.ts e export-completo/route.ts).
    // Pega o total antes (count exato) e busca as paginas em paralelo, e dispara
    // isso ao mesmo tempo que buscarItensNFFrio (Contabo) -- as duas buscas sao
    // independentes entre si, mas rodavam em serie; esta tela roda sempre que o
    // periodo (padrao "ano corrente") cruza a janela quente de 90 dias.
    const [{ count: totalProdutos }, itensFrios] = await Promise.all([
      supabase.from('produtos').select('codigo_produto', { count: 'exact', head: true }).eq('loja_id', lojaId),
      buscarItensNFFrio({ lojaId, dataInicio: ini, dataFinal: dataFinalFria }),
    ])
    const numPaginasProd = Math.ceil((totalProdutos ?? 0) / 1000)
    const blocosProd = await Promise.all(
      Array.from({ length: numPaginasProd }, (_, pg) =>
        supabase
          .from('produtos')
          .select('codigo_produto, tipo_item, descricao_familia')
          .eq('loja_id', lojaId)
          .range(pg * 1000, pg * 1000 + 999)
      )
    )
    const prodMetaRaw = blocosProd.flatMap((r) => r.data ?? [])
    meta = new Map()
    for (const p of prodMetaRaw) {
      meta.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
    }
    const fDrill = { status: statusSel, familias: [...familiasSel], tipos: [...tiposSel], fornecedor, cfops: [...cfopsSel], produto, local: localCod }
    for (const p of pares) {
      const rot = p.rotulo === 'Sem classificação' ? SEM : p.rotulo
      if (p.dim === 'familia') fDrill.familias = [rot]
      if (p.dim === 'tipo') fDrill.tipos = [rot]
      if (p.dim === 'fornecedor') fDrill.fornecedor = rot
      if (p.dim === 'cfop') fDrill.cfops = [rot]
      if (p.dim === 'produto' && rot !== SEM) fDrill.produto = rot
    }
    filtrados = filtrarItensCompras(itensFrios, fDrill, meta)
    const totFrio = agregarComprasTotal(filtrados)
    total += totFrio.valor
    nNotas += totFrio.nNotas
    for (const l of agregarComprasMatriz(filtrados, dimExibida ?? 'produto', meta)) matrizRaw.push(l)
    for (const l of agregarComprasMatriz(filtrados, 'fornecedor', meta)) fornLinhas.push(l)
    const soSituacao = filtrarItensCompras(itensFrios, { status: statusSel, familias: [], tipos: [], fornecedor: null, cfops: [], produto: null, local: null }, meta)
    for (const l of agregarComprasMatriz(soSituacao, 'fornecedor', meta)) fornNomes.add(l.rotulo)
  }

  // Nível final: itens individuais (RPC de detalhe + pedaço frio mapeado).
  let itensDetalhe: LinhaDetalheCompra[] = []
  if (nivelItens) {
    const { data: det, error: erroDetalhe } = await supabase
      .rpc('relatorio_compras_detalhe', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, ...filtrosComDrill })
      .range(0, 499)
    logErroRpc('relatorio_compras_detalhe', erroDetalhe)
    itensDetalhe = (det ?? []) as LinhaDetalheCompra[]
    if (ini < corte) {
      itensDetalhe = [...mapearComprasDetalhe(filtrados, meta), ...itensDetalhe]
        .sort((a, b) => String(b.data).localeCompare(String(a.data)) || Number(b.total) - Number(a.total))
        .slice(0, 500)
    }
  }

  // Rótulo amigável conforme a dimensão EXIBIDA (tipo -> nome; produto -> título limpo;
  // rótulos opacos tipo "Sem classificação" -> explicação).
  const rotuloDe = (raw: string): string => {
    const opaco = explicarRotulo(raw)
    if (opaco) return opaco.label
    if (dimExibida === 'tipo') return TIPO_LABEL.get(raw) ?? raw
    if (dimExibida === 'produto') return formatarNomeProduto(raw) || raw
    return raw
  }
  const dimLabel = DIMS.find((d) => d.value === (dimExibida ?? dim))?.label ?? 'Item'

  const [familias, { data: locaisRaw }] = await Promise.all([
    buscarFamilias(),
    supabase
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .order('descricao'),
  ])
  // Opções de CFOP: só os que apareceram no período (bonificação/comodato já não
  // aparecem aqui, pois a RPC os exclui sempre; não contam como compra).
  const opcoesCfop = ((cfopDimRaw ?? []) as { rotulo: string }[]).map((r) => ({
    value: r.rotulo,
    label: `${r.rotulo} · ${descreverCFOP(r.rotulo).desc}`,
  }))
  // Fornecedor, Família e Situação ficam sempre à vista (FiltrosNotas); o resto vai na gaveta "Filtros".
  const camposMais: CampoFiltro[] = [
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo de mercadoria', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'multi-select', nome: 'cfop', label: 'CFOP', opcoes: opcoesCfop },
    {
      tipo: 'select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
  ]

  // Excel e "Baixar tudo": mesmo recorte da tela (as rotas leem data_inicio/data_final).
  const exportParams = new URLSearchParams({ data_inicio: ini, data_final: fim, dim })
  if (sp.familia) exportParams.set('familia', sp.familia)
  if (sp.tipo) exportParams.set('tipo', sp.tipo)
  if (fornecedor) exportParams.set('fornecedor', fornecedor)
  if (sp.cfop) exportParams.set('cfop', sp.cfop)
  // Achado real: produto e local ficavam de fora daqui -- os filtros
  // funcionavam na tela (RPCs recebem tudo), mas o Excel/"Baixar tudo"
  // silenciosamente ignorava esses dois filtros porque a URL de export
  // nunca os carregava, mesmo as rotas de export já sabendo lê-los.
  if (produto) exportParams.set('produto', produto)
  if (sp.local) exportParams.set('local', sp.local)
  if (sp.status) exportParams.set('status', sp.status)

  // Parâmetros que atravessam links (período, visão, filtros, trilha, busca).
  const base: Record<string, string> = {
    ini, fim, dim: dim === 'familia' ? '' : dim, aba: mensal ? 'mensal' : '',
    fornecedor: sp.fornecedor ?? '', familia: sp.familia ?? '', status: sp.status ?? '', tipo: sp.tipo ?? '', cfop: sp.cfop ?? '',
    produto: sp.produto ?? '', local: sp.local ?? '', drill: sp.drill ?? '', q, sentido: sentido === 'mais' ? '' : sentido,
  }
  const href = (over: Record<string, string>) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) u.set(k, v)
    return `/relatorio-compras${u.size ? `?${u}` : ''}`
  }
  const spDrill = { ...base, q: '' }
  const hrefDrill = (chave: string) =>
    hrefComDrill('/relatorio-compras', spDrill, [...pares, { dim: dimExibida ?? dim, rotulo: chave === 'Sem classificação' ? SEM : chave }])

  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chipAtivo = `${chipBase} bg-brand-fill text-white`
  const chipInativo = `${chipBase} bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text`

  // ---- dados de cada visão ----
  const rankTodos = rankingCompras(matrizRaw, rotuloDe)
  const rankVis = ordenarRanking(filtrarPorNome(rankTodos, q), 'valor', sentido)
  const rankPagina = rankVis.slice(0, LIMITE_LINHAS)
  const matriz = mensal && !nivelItens ? matrizCompras(matrizRaw, ini, fim, rotuloDe, LIMITE_LINHAS) : null
  const rankForn = rankingCompras(fornLinhas)
  const maiorForn = rankForn[0] ?? null
  const ticket = nNotas > 0 ? total / nNotas : null
  const legenda = (l: LinhaRanking) => `${fmtPct(l.pct)} do total`
  const rotuloBusca = (DIMS.find((d) => d.value === dimExibida)?.label ?? 'item').toLowerCase()

  const formBusca = (
    <form action="/relatorio-compras" className="flex w-full flex-wrap items-center gap-2">
      {Object.entries(base).filter(([k, v]) => v && !['q', 'sentido'].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {base.sentido ? <input type="hidden" name="sentido" value={base.sentido} /> : null}
      <input name="q" defaultValue={q} placeholder={`Buscar ${rotuloBusca}…`} className="h-9 min-w-0 flex-1 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text sm:w-64 sm:flex-none" />
      <button type="submit" className={chipInativo}>Buscar</button>
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={href({ sentido: '' })} className={sentido === 'mais' ? chipAtivo : chipInativo}>Mais comprados</Link>
        <Link href={href({ sentido: 'menos' })} className={sentido === 'menos' ? chipAtivo : chipInativo}>Menos comprados</Link>
      </div>
    </form>
  )

  const trilha = (
    <DrillBreadcrumb
      basePath="/relatorio-compras"
      sp={spDrill}
      pares={pares}
      raiz={`Compras por ${(DIMS.find((d) => d.value === dim)?.label ?? dim).toLowerCase()}`}
      rotuloDe={(p) =>
        p.rotulo === SEM || p.rotulo === 'Sem classificação'
          ? explicarRotulo('Sem classificação')!.label
          : p.dim === 'tipo'
            ? TIPO_LABEL.get(p.rotulo) ?? p.rotulo
            : p.dim === 'produto'
              ? formatarNomeProduto(p.rotulo) || p.rotulo
              : p.rotulo
      }
    />
  )

  const semCompras = total === 0 && matrizRaw.length === 0 && itensDetalhe.length === 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="Compras"
        icon={ShoppingCart}
        description="Compras por nota fiscal de entrada: escolha o período, filtre e veja quanto, de quem e o que você comprou."
        voltarHref="/relatorios"
        actions={
          <>
            <a
              href={`/relatorio-compras/export?${exportParams.toString()}`}
              target="_blank"
              rel="noopener noreferrer"
              className={btnClass('outline')}
              title="Excel desta abertura: Resumo mês a mês + Detalhado (com filtros)"
            >
              <Download className="size-4" /> Excel
            </a>
            <a
              href={`/relatorio-compras/export-completo?${exportParams.toString()}`}
              target="_blank"
              rel="noopener noreferrer"
              className={btnClass('outline')}
              title="Pasta completa: matriz mês a mês por Tipo, Família, Fornecedor, CFOP e Produto + Detalhado"
            >
              <Download className="size-4" /> Baixar tudo
            </a>
          </>
        }
      />

      <PeriodoBar basePath="/relatorio-compras" params={base} ini={ini} fim={fim} hoje={hoje} />
      <FiltrosNotas
        fornecedores={[...fornNomes].filter((f) => f !== 'Sem classificação').sort((a, b) => a.localeCompare(b, 'pt-BR'))}
        familias={familias.map((f) => ({ value: f.descricao, label: f.descricao }))}
        situacoes={SITUACOES}
      >
        <FiltrosGaveta
          basePath="/relatorio-compras"
          campos={camposMais}
          defaults={Object.fromEntries(camposMais.map((c) => [c.nome, sp[c.nome] ?? '']))}
          persistirEm="/relatorio-compras"
        />
      </FiltrosNotas>
      <ChipsFiltrosAtivos basePath="/relatorio-compras" campos={camposMais} persistirEm="/relatorio-compras" />

      {per.cortado && <p className="text-[13px] text-text-muted">Período limitado a 10 anos: mostrando os mais recentes.</p>}
      {errosRpc.length > 0 && (
        <p className="flex items-start gap-2 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
          <span className="mt-[5px] size-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <span>Falha ao consultar: <strong className="text-warn">{[...new Set(errosRpc)].join(', ')}</strong>. Os números podem estar incompletos; recarregue a página e, se persistir, avise o suporte.</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card titulo="Total comprado" valor={<Money value={total} />} />
        <Card titulo="Notas" valor={nNotas.toLocaleString('pt-BR')} sub={plural(rankForn.length, 'fornecedor', 'fornecedores')} />
        <Card titulo="Ticket médio por nota" valor={ticket == null ? '—' : <Money value={ticket} />} />
        <Card titulo="Maior fornecedor" valor={maiorForn ? <Money value={maiorForn.valor} /> : '—'} sub={maiorForn ? `${maiorForn.rotulo} · ${fmtPct(maiorForn.pct)}` : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {DIMS.map((d) => (
          <Link key={d.value} href={href({ dim: d.value === 'familia' ? '' : d.value, aba: '', drill: '', q: '' })} className={!mensal && dim === d.value ? chipAtivo : chipInativo}>{d.visao}</Link>
        ))}
        <Link href={href({ aba: 'mensal', q: '' })} className={mensal ? chipAtivo : chipInativo}>Evolução mensal</Link>
      </div>
      {trilha}

      {semCompras ? (
        <EmptyState icon={ShoppingCart} title="Nenhuma compra no período" hint="Mude o período ou limpe os filtros de fornecedor, família e situação." />
      ) : nivelItens ? (
        itensDetalhe.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Sem itens neste recorte" hint="Ajuste o período ou volte um nível na trilha." />
        ) : (
          <div className="space-y-3">
            <p className="px-1 text-[13px] text-text-muted">
              {plural(itensDetalhe.length, 'item', 'itens')} · <Money value={itensDetalhe.reduce((s, it) => s + Number(it.total), 0)} />
            </p>
            <ListaItensCompra itens={itensDetalhe} />
            {itensDetalhe.length >= 500 && (
              <p className="px-1 text-[12px] text-text-muted">Mostrando os 500 itens mais recentes. Use o Excel para a lista completa.</p>
            )}
            <p className="px-1 text-[12px] text-text-muted">Toque num item para ver as movimentações do produto.</p>
          </div>
        )
      ) : matriz ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-text-muted">Por</span>
            {DIMS.map((d) => <Link key={d.value} href={href({ dim: d.value === 'familia' ? '' : d.value, drill: '' })} className={pares.length === 0 && dim === d.value ? chipAtivo : chipInativo}>{d.label}</Link>)}
          </div>
          <MatrizMensalTabela matriz={matriz} titulo={dimLabel} />
          {rankTodos.length > LIMITE_LINHAS && (
            <p className="px-1 text-[12px] text-text-muted">Mostrando as {LIMITE_LINHAS} maiores linhas de {rankTodos.length.toLocaleString('pt-BR')}. Use &quot;Baixar tudo&quot; para o completo.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {formBusca}
          {rankVis.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="Nada encontrado" hint={`Nenhum(a) ${rotuloBusca} bate com a busca.`} />
          ) : (
            <RankingBarras linhas={rankPagina} ordem="valor" legenda={legenda} hrefDe={hrefDrill} />
          )}
          {rankVis.length > LIMITE_LINHAS && (
            <p className="px-1 text-[12px] text-text-muted">Mostrando {LIMITE_LINHAS} de {rankVis.length.toLocaleString('pt-BR')}. Use &quot;Baixar tudo&quot; para o completo.</p>
          )}
          <p className="px-1 text-[12px] text-text-muted">
            {dimExibida === 'produto' ? 'Toque num produto para ver os itens comprados.' : `Toque num(a) ${rotuloBusca} para ver os produtos.`}
          </p>
        </div>
      )}

      <p className="px-1 text-[12px] text-text-muted">
        Valor dos itens (quantidade × preço unitário), sem frete e impostos da nota. Bonificação (CFOP 910) e comodato (CFOP 908) não contam como compra e não entram nestes números.
      </p>
    </div>
  )
}
