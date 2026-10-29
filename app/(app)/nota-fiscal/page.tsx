import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText, Download, FileUp, KanbanSquare, PenLine } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao, isAdmin } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { SyncButton } from '@/components/SyncButton'
import { StatusSefaz, type EstadoSefaz } from '@/components/nota-fiscal/StatusSefaz'
import { BuscarPorChave } from '@/components/nota-fiscal/BuscarPorChave'
import { FiltrosNotas } from '@/components/nota-fiscal/FiltrosNotas'
import { ListaNotasCompra } from '@/components/nota-fiscal/ListaNotasCompra'
import { DetalheItemCompra } from '@/components/nota-fiscal/DetalheItemCompra'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { RankingBarras } from '@/components/faturamento/RankingBarras'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'
import { TabelaDiaria } from '@/components/faturamento/TabelaDiaria'
import { MatrizMensalTabela } from '@/components/faturamento/MatrizMensalTabela'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { CATEGORIAS_NF } from '@/lib/nota-fiscal-categoria'
import { buscarFamilias } from '@/lib/actions/produto'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { lerPeriodo, addDias } from '@/lib/faturamento-periodo'
import { filtrarPorNome, matrizMensal, ordenarRanking, posicaoNoRanking, rankear, resumir, serieDiaria, type LinhaRanking } from '@/lib/faturamento-itens'
import { lerTipoValor } from '@/lib/compras/custo-estoque-item'
import {
  VISOES, SEM_FAMILIA, filtrarNotas, fornecedoresDistintos, itemParaLinha, itensDasNotas, lerOrdem, notaParaLinha, ordenarNotas, type Visao,
} from '@/lib/notas-compras'
import { carregarItensCompra, carregarNotasCompra } from '@/lib/notas-compras-loader'

const POR_PAGINA = 50
// Notas: periodo livre (a tela antiga aceitava qualquer intervalo). Por dia mostra os 366 mais recentes.
const MAX_DIAS_NOTAS = 3700
const DIMS_MENSAL = [{ value: 'fornecedor', label: 'Fornecedor' }, { value: 'familia', label: 'Família' }, { value: 'produto', label: 'Produto' }] as const
const ORDENS = [
  { label: 'Mais recentes', ord: '', dir: '' },
  { label: 'Mais antigas', ord: '', dir: 'asc' },
  { label: 'Maior valor', ord: 'valor', dir: '' },
  { label: 'Menor valor', ord: 'valor', dir: 'asc' },
] as const
const fmtDM = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

type Sp = Record<string, string | undefined>

export default async function NotaFiscalPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const supabase = await createClient()

  // Periodo: ini/fim/mes (padrao do Faturamento); data_inicio/data_final de links antigos continuam valendo.
  const per = lerPeriodo({ ini: sp.ini ?? sp.data_inicio, fim: sp.fim ?? sp.data_final, mes: sp.mes }, hoje, MAX_DIAS_NOTAS)
  const visao: Visao = VISOES.find((v) => v.value === sp.aba)?.value ?? 'notas'
  const tipos = valoresMulti(sp.tipo)
  const familias = valoresMulti(sp.familia)
  const localCod = sp.local && !Number.isNaN(Number(sp.local)) ? Number(sp.local) : null
  const status = sp.status ?? ''
  const fornecedor = sp.fornecedor ?? ''
  const transportadora = (sp.transportadora ?? '').slice(0, 120)
  const q = (sp.q ?? '').slice(0, 80)
  const { ord, dir } = lerOrdem(sp.ord, sp.dir)
  const page = Math.max(1, Number(sp.page) || 1)
  const porMensal = DIMS_MENSAL.find((d) => d.value === sp.por)?.value ?? 'fornecedor'
  const ordemRank = sp.ordem === 'quant' ? 'quant' : 'valor'
  const sentido = sp.sentido === 'menos' ? 'menos' : 'mais'
  // Produtos/Famílias/Evolução por item: valor que entrou no estoque (regra do Omie) ou valor da nota
  const tipoValor = lerTipoValor(sp.valor)

  const podeSync = await isAdmin()
  const modo = await modoDaLoja(lojaId)
  const proprio = modo === 'proprio'
  const podeLancarManual = proprio && (await requirePermissao(lojaId, 'Compras - Criar'))
  const podeBuscarChave = proprio && (await requirePermissao(lojaId, 'Notas Fiscais - Sincronizar'))
  let estadoSefaz: EstadoSefaz | null = null
  if (proprio) {
    const [{ data: n }, { data: l }, { count: aConferir }] = await Promise.all([
      supabase.from('sefaz_nsu').select('ativo, auto_lancar, auto_ciencia, ambiente, ultima_consulta, bloqueado_ate, ultimo_cstat, ultimo_erro').eq('loja_id', lojaId).maybeSingle(),
      supabase.from('lojas').select('certificado_path').eq('id', lojaId).maybeSingle(),
      supabase.from('compras_proprio').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).in('status', ['pendente', 'parcial']),
    ])
    estadoSefaz = {
      existe: !!n, ativo: n?.ativo ?? true, autoLancar: n?.auto_lancar ?? true, autoCiencia: n?.auto_ciencia ?? true, ambiente: n?.ambiente === 2 ? 2 : 1,
      ultimaConsulta: n?.ultima_consulta ?? null, bloqueadoAte: n?.bloqueado_ate ?? null, ultimoCstat: n?.ultimo_cstat ?? null, ultimoErro: n?.ultimo_erro ?? null,
      semCertificado: !l?.certificado_path, aConferir: aConferir ?? 0,
    }
  }

  const filtrosBanco = { tipos, familias, produto: sp.produto ?? '', local: localCod, natureza: sp.natureza ?? '', categoria: sp.categoria ?? '' }
  const [{ notas: notasPeriodo, erros }, familiasOpcoes, { data: locaisRaw }] = await Promise.all([
    carregarNotasCompra(lojaId, per.ini, per.fim, filtrosBanco),
    buscarFamilias(),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).order('descricao'),
  ])
  // Fornecedores do filtro: os do periodo com os outros filtros (menos o proprio fornecedor).
  const fornecedores = fornecedoresDistintos(filtrarNotas(notasPeriodo, { status, numero: sp.num_nfe }))
  const notas = filtrarNotas(notasPeriodo, { status, fornecedor, numero: sp.num_nfe, transportadora })
  const linhasNotas = notas.map((n) => notaParaLinha(n))
  const kp = resumir(linhasNotas)
  const rankForn = rankear(linhasNotas, 'produto')
  const maiorForn = rankForn[0] ?? null

  // Itens so quando a visao precisa (Produtos, Familias, Evolucao por familia/produto).
  const precisaItens = visao === 'produtos' || visao === 'familias' || (visao === 'mensal' && porMensal !== 'fornecedor')
  const { itens: itensTodos, erros: errosItens } = precisaItens
    ? await carregarItensCompra(lojaId, notas, { produto: filtrosBanco.produto, local: localCod })
    : { itens: [], erros: [] as string[] }
  const itens = itensDasNotas(itensTodos, new Set(notas.map((n) => n.id)), { tipos, familias })
  const linhasItens = itens.map((i) => itemParaLinha(i, tipoValor))
  const avisos = [...new Set([...erros, ...errosItens])]

  // Parametros que atravessam links (periodo, visao, filtros, ordenacao, busca).
  const base: Record<string, string> = {
    ini: per.ini, fim: per.fim, aba: visao === 'notas' ? '' : visao,
    fornecedor, transportadora, familia: familias.join(','), status, tipo: tipos.join(','), local: sp.local ?? '', natureza: sp.natureza ?? '',
    produto: sp.produto ?? '', categoria: sp.categoria ?? '', num_nfe: sp.num_nfe ?? '',
    q, ord: sp.ord ?? '', dir: sp.dir ?? '', por: porMensal === 'fornecedor' ? '' : porMensal, valor: tipoValor === 'estoque' ? '' : 'fiscal',
    ordem: ordemRank === 'valor' ? '' : ordemRank, sentido: sentido === 'mais' ? '' : sentido,
  }
  const href = (over: Record<string, string>) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) u.set(k, v)
    return `/nota-fiscal${u.size ? `?${u}` : ''}`
  }
  // Excel e PDF: mesmo recorte da tela (rotas antigas leem data_inicio/data_final; situacao explicita).
  const exportQs = new URLSearchParams()
  exportQs.set('data_inicio', per.ini)
  exportQs.set('data_final', per.fim)
  exportQs.set('status', status || 'VALIDAS')
  for (const k of ['fornecedor', 'transportadora', 'num_nfe', 'tipo', 'natureza', 'produto', 'categoria', 'familia', 'local'] as const) if (base[k]) exportQs.set(k, base[k])

  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chipAtivo = `${chipBase} bg-brand-fill text-white`
  const chipInativo = `${chipBase} bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text`

  const situacoes = proprio
    ? [{ value: '', label: 'Válidas (sem canceladas)' }, { value: 'CONCLUIDA', label: 'Lançadas no estoque' }, { value: 'PENDENTE', label: 'A conferir' }, { value: 'CANCELADA', label: 'Canceladas' }, { value: 'TODAS', label: 'Todas' }]
    : [{ value: '', label: 'Válidas (sem canceladas)' }, { value: 'CONCLUIDA', label: 'Concluídas' }, { value: 'MANIFESTADA', label: 'Manifestadas' }, { value: 'PENDENTE', label: 'Pendentes' }, { value: 'CANCELADA', label: 'Canceladas' }, { value: 'TODAS', label: 'Todas' }]
  if (status && !situacoes.some((s) => s.value === status)) situacoes.push({ value: status, label: status === 'C' ? 'Concluídas' : status === 'P' ? 'Pendentes' : `Etapa ${status}` })

  // "Mais filtros": o que a tela antiga tinha e nao cabe na linha principal.
  const camposMais: CampoFiltro[] = [
    { tipo: 'texto', nome: 'num_nfe', label: 'Nº NFe' },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo', opcoes: PRODUTO_TIPO_ITEM },
    { tipo: 'select', nome: 'local', label: 'Local de estoque', opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })) },
    { tipo: 'texto', nome: 'natureza', label: 'Natureza da operação' },
    { tipo: 'texto', nome: 'produto', label: 'Produto' },
    { tipo: 'multi-select', nome: 'categoria', label: 'Categoria', opcoes: CATEGORIAS_NF.map((c) => ({ value: c.value, label: c.label })) },
  ]

  // ---- dados de cada visao ----
  const notasOrdenadas = visao === 'notas' ? ordenarNotas(filtrarNotas(notas, { q, status: 'TODAS' }), ord, dir) : []
  const notasPagina = notasOrdenadas.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)
  const temProxima = notasOrdenadas.length > page * POR_PAGINA

  const rankFornVis = visao === 'fornecedores' ? ordenarRanking(filtrarPorNome(rankForn, q), ordemRank, sentido) : []
  const rankTranspVis = visao === 'transportadoras' ? ordenarRanking(filtrarPorNome(rankear(notas.map((n) => notaParaLinha(n, 'transportadora')), 'produto'), q), ordemRank, sentido) : []
  const rankItensTodos = visao === 'produtos' ? rankear(linhasItens, 'produto') : visao === 'familias' ? rankear(linhasItens, 'familia') : []
  const rankItensVis = ordenarRanking(filtrarPorNome(rankItensTodos, q), visao === 'familias' ? 'valor' : ordemRank, sentido)
  const unidadeDe = new Map<string, string>()
  for (const i of itens) {
    const k = i.idProduto != null ? String(i.idProduto) : `nome:${i.produto}`
    if (!unidadeDe.has(k) && i.unidade) unidadeDe.set(k, i.unidade)
  }

  const selecionado = visao === 'produtos' && sp.item ? rankItensTodos.find((r) => r.chave === sp.item) : undefined
  const itensSel = selecionado ? itens.filter((i) => (i.idProduto != null ? String(i.idProduto) : `nome:${i.produto}`) === selecionado.chave) : []
  const notaPorId = new Map(notas.map((n) => [n.id, n]))
  const notasSel = (() => {
    const m = new Map<number, { quant: number; valor: number }>()
    for (const i of itensSel) {
      const g = m.get(i.notaId) ?? { quant: 0, valor: 0 }
      g.quant += i.quant
      g.valor += i.valor
      m.set(i.notaId, g)
    }
    return [...m.entries()].flatMap(([id, g]) => { const nota = notaPorId.get(id); return nota ? [{ nota, ...g }] : [] })
      .sort((a, b) => b.nota.dia.localeCompare(a.nota.dia) || b.nota.id - a.nota.id)
  })()

  const iniSerie = per.ini < addDias(per.fim, -365) ? addDias(per.fim, -365) : per.ini
  const serie = visao === 'dias' ? serieDiaria(linhasNotas, iniSerie, per.fim) : []
  const mensal = visao === 'mensal' ? (porMensal === 'fornecedor' ? matrizMensal(linhasNotas, 'produto', per.ini, per.fim) : matrizMensal(linhasItens, porMensal, per.ini, per.fim)) : null

  const legendaForn = (l: LinhaRanking) => `${plural(l.cupons, 'nota', 'notas')} · ${fmtPct(l.pct)}`
  const legendaProd = (l: LinhaRanking) => `${fmtQtd(l.quant)} ${unidadeDe.get(l.chave) ?? 'un'} · ${plural(l.cupons, 'nota', 'notas')} · ${fmtPct(l.pct)}`
  const legendaFam = (l: LinhaRanking) => `${plural(l.cupons, 'nota', 'notas')} · ${fmtPct(l.pct)}`
  const rotuloBusca = visao === 'transportadoras' ? 'transportadora' : visao === 'fornecedores' ? 'fornecedor' : visao === 'produtos' ? 'produto' : visao === 'familias' ? 'família' : 'fornecedor, nº ou natureza'

  const formBusca = (
    <form action="/nota-fiscal" className="flex w-full flex-wrap items-center gap-2">
      {Object.entries(base).filter(([k, v]) => v && !['q', 'ord', 'dir', 'ordem', 'sentido'].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {(['ord', 'dir', 'ordem', 'sentido'] as const).map((k) => base[k] ? <input key={k} type="hidden" name={k} value={base[k]} /> : null)}
      <input name="q" defaultValue={q} placeholder={`Buscar ${rotuloBusca}…`} className="h-9 min-w-0 flex-1 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text sm:w-64 sm:flex-none" />
      <button type="submit" className={chipInativo}>Buscar</button>
      {visao === 'notas' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {ORDENS.map((o) => {
            const ativo = (o.ord === 'valor' ? ord === 'valor' : ord === 'dia') && (o.dir === 'asc' ? dir === 'asc' : dir === 'desc')
            return <Link key={o.label} href={href({ ord: o.ord, dir: o.dir, page: '' })} className={ativo ? chipAtivo : chipInativo}>{o.label}</Link>
          })}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={href({ sentido: '' })} className={sentido === 'mais' ? chipAtivo : chipInativo}>Mais comprados</Link>
          <Link href={href({ sentido: 'menos' })} className={sentido === 'menos' ? chipAtivo : chipInativo}>Menos comprados</Link>
          {visao !== 'familias' && (
            <>
              <span className="text-[12px] text-text-muted">por</span>
              <Link href={href({ ordem: '' })} className={ordemRank === 'valor' ? chipAtivo : chipInativo}>R$</Link>
              <Link href={href({ ordem: 'quant' })} className={ordemRank === 'quant' ? chipAtivo : chipInativo}>{visao === 'fornecedores' || visao === 'transportadoras' ? 'Nº de notas' : 'Quantidade'}</Link>
            </>
          )}
          {visao !== 'fornecedores' && visao !== 'transportadoras' && (
            <>
              <span className="text-[12px] text-text-muted">valor</span>
              <Link href={href({ valor: '' })} title="Valor que entrou no estoque (como no Omie: sem os impostos que viram crédito)" className={tipoValor === 'estoque' ? chipAtivo : chipInativo}>De estoque</Link>
              <Link href={href({ valor: 'fiscal' })} title="Quantidade × preço da nota" className={tipoValor === 'fiscal' ? chipAtivo : chipInativo}>Da nota</Link>
            </>
          )}
        </div>
      )}
    </form>
  )

  const vazioPeriodo = (
    <EmptyState
      icon={FileText}
      title="Nenhuma nota no período"
      hint={proprio ? 'Mude o período, limpe os filtros, clique em Buscar na SEFAZ ou importe um XML.' : 'Mude o período ou limpe os filtros de fornecedor, família e situação.'}
    />
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notas Fiscais"
        icon={FileText}
        description="Compras recebidas: escolha o período, filtre e veja quanto e de quem você comprou."
        actions={
          <>
            <a href={`/nota-fiscal/relatorio?${exportQs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}><FileText className="size-4" /> Relatório PDF</a>
            <a href={`/nota-fiscal/export?${exportQs}`} className={btnClass('outline')}><Download className="size-4" /> Excel</a>
            {proprio && <a href={`/nota-fiscal/contabilidade?ini=${per.ini}&fim=${per.fim}`} title="Uma linha por item, as 195 colunas do relatório de entradas do Omie (pela data de registro)" className={btnClass('outline')}><Download className="size-4" /> Excel da contabilidade</a>}
            {proprio && <Link href="/nota-fiscal/etapas" className={btnClass('outline')}><KanbanSquare className="size-4" /> Etapas do recebimento</Link>}
            {podeBuscarChave && <BuscarPorChave />}
            {podeLancarManual && (
              <>
                <Link href="/nota-fiscal/importar" className={btnClass('outline')}><FileUp className="size-4" /> Importar XML</Link>
                <Link href="/nota-fiscal/nova" className={btnClass('outline')}><PenLine className="size-4" /> Lançar sem XML</Link>
              </>
            )}
            {podeSync && <SyncButton endpoint="/api/sync/notas-fiscais" label={proprio ? 'Buscar na SEFAZ' : 'Atualizar agora'} />}
          </>
        }
      />
      {estadoSefaz && <StatusSefaz estado={estadoSefaz} podeConfigurar={podeSync} />}

      <PeriodoBar basePath="/nota-fiscal" params={{ ...base, page: '', item: '' }} ini={per.ini} fim={per.fim} hoje={hoje} />
      <FiltrosNotas
        fornecedores={fornecedores}
        familias={familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao }))}
        situacoes={situacoes}
      >
        <FiltrosGaveta
          basePath="/nota-fiscal"
          campos={camposMais}
          defaults={Object.fromEntries(camposMais.map((c) => [c.nome, sp[c.nome] ?? '']))}
        />
      </FiltrosNotas>
      <ChipsFiltrosAtivos basePath="/nota-fiscal" campos={camposMais} />

      {per.cortado && <p className="text-[13px] text-text-muted">Período limitado a 10 anos: mostrando os mais recentes.</p>}
      {avisos.length > 0 && (
        <p className="flex items-start gap-2 rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
          <span className="mt-[5px] size-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <span>Falha ao consultar: <strong className="text-warn">{avisos.join(', ')}</strong>. Os números podem estar incompletos; recarregue a página.</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card titulo="Total comprado" valor={<Money value={kp.faturado} />} />
        <Card titulo="Notas" valor={kp.cupons.toLocaleString('pt-BR')} sub={plural(rankForn.length, 'fornecedor', 'fornecedores')} />
        <Card titulo="Ticket médio por nota" valor={kp.ticket == null ? '—' : <Money value={kp.ticket} />} />
        <Card titulo="Maior fornecedor" valor={maiorForn ? <Money value={maiorForn.valor} /> : '—'} sub={maiorForn ? `${maiorForn.rotulo} · ${fmtPct(maiorForn.pct)}` : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {VISOES.map((v) => <Link key={v.value} href={href({ aba: v.value === 'notas' ? '' : v.value, item: '', page: '', q: '' })} className={visao === v.value ? chipAtivo : chipInativo}>{v.label}</Link>)}
      </div>

      {transportadora && (
        <p className="px-1 text-[13px] text-text-muted">Transportadora: <strong className="text-text">{transportadora}</strong> · <Link href={href({ transportadora: '' })} className="text-brand hover:underline">ver todas</Link></p>
      )}

      {notas.length === 0 ? vazioPeriodo : visao === 'notas' ? (
        <div className="space-y-3">
          {formBusca}
          <p className="px-1 text-[13px] text-text-muted">
            {plural(notasOrdenadas.length, 'nota', 'notas')}{q ? ` com “${q}”` : ''} · <Money value={notasOrdenadas.reduce((s, n) => s + n.valor, 0)} />
          </p>
          {notasOrdenadas.length === 0
            ? <EmptyState icon={FileText} title="Nada encontrado" hint="Nenhuma nota bate com a busca." />
            : <ListaNotasCompra notas={notasPagina} maxValor={Math.max(...notasOrdenadas.map((n) => n.valor))} />}
          {(page > 1 || temProxima) && <Paginacao basePath="/nota-fiscal" page={page} temProxima={temProxima} total={notasOrdenadas.length} porPagina={POR_PAGINA} />}
        </div>
      ) : visao === 'fornecedores' ? (
        <div className="space-y-3">
          {formBusca}
          {rankFornVis.length === 0
            ? <EmptyState icon={FileText} title="Nada encontrado" hint="Nenhum fornecedor bate com a busca." />
            : <RankingBarras linhas={rankFornVis} ordem={ordemRank} legenda={legendaForn} hrefDe={(chave) => href({ aba: '', fornecedor: chave.replace(/^nome:/, ''), q: '', ordem: '', sentido: '' })} />}
          <p className="px-1 text-[12px] text-text-muted">Toque num fornecedor para ver as notas dele.</p>
        </div>
      ) : visao === 'transportadoras' ? (
        <div className="space-y-3">
          {formBusca}
          {rankTranspVis.length === 0
            ? <EmptyState icon={FileText} title="Nada encontrado" hint="Nenhuma transportadora bate com a busca." />
            : <RankingBarras linhas={rankTranspVis} ordem={ordemRank} legenda={legendaForn} hrefDe={(chave) => href({ aba: '', transportadora: chave.replace(/^nome:/, ''), q: '', ordem: '', sentido: '' })} />}
          <p className="px-1 text-[12px] text-text-muted">Transportadora informada no recebimento (frete). Toque numa para ver as notas dela.</p>
        </div>
      ) : visao === 'produtos' || visao === 'familias' ? (
        <div className="space-y-3">
          {selecionado && (
            <DetalheItemCompra
              item={selecionado}
              unidade={unidadeDe.get(selecionado.chave) ?? ''}
              posicao={posicaoNoRanking(rankItensTodos, selecionado.chave)}
              total={rankItensTodos.length}
              serie={serieDiaria(itensSel.map((i) => itemParaLinha(i, tipoValor)), iniSerie, per.fim)}
              notas={notasSel}
              fecharHref={href({ item: '' })}
              produtoHref={modo !== 'nenhum' && !selecionado.chave.startsWith('nome:') ? `/estoque/produto/${selecionado.chave}` : undefined}
            />
          )}
          {formBusca}
          {rankItensVis.length === 0 ? (
            <EmptyState icon={FileText} title={itens.length ? 'Nada encontrado' : 'Sem itens nas notas'} hint={itens.length ? 'Nenhum item bate com a busca.' : 'As notas do período não têm itens com esses filtros.'} />
          ) : (
            <RankingBarras
              linhas={rankItensVis}
              ordem={visao === 'familias' ? 'valor' : ordemRank}
              selecionado={sp.item}
              legenda={visao === 'produtos' ? legendaProd : legendaFam}
              hrefDe={visao === 'produtos'
                ? (chave) => href({ item: chave })
                : (chave) => (chave === SEM_FAMILIA ? undefined : href({ aba: 'produtos', familia: chave, q: '', item: '' }))}
            />
          )}
          <p className="px-1 text-[12px] text-text-muted">
            Valor dos itens (quantidade × preço unitário), sem frete e impostos da nota.{visao === 'familias' ? ' Toque numa família para ver os produtos dela.' : ' Toque num produto para ver as notas em que ele veio.'}
          </p>
        </div>
      ) : visao === 'dias' ? (
        <div className="space-y-3">
          {iniSerie !== per.ini && <p className="text-[13px] text-text-muted">Por dia mostra os 366 dias mais recentes do período.</p>}
          <BarrasDiarias dias={serie} nome="Compra" />
          <TabelaDiaria dias={[...serie].reverse()} hoje={hoje} rotulo="Comprado" />
        </div>
      ) : mensal ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-text-muted">Por</span>
            {DIMS_MENSAL.map((d) => <Link key={d.value} href={href({ por: d.value === 'fornecedor' ? '' : d.value })} className={porMensal === d.value ? chipAtivo : chipInativo}>{d.label}</Link>)}
          </div>
          <MatrizMensalTabela matriz={mensal} titulo={DIMS_MENSAL.find((d) => d.value === porMensal)?.label ?? 'Item'} />
          {porMensal !== 'fornecedor' && <p className="px-1 text-[12px] text-text-muted">Família e produto somam o valor dos itens (sem frete e impostos da nota).</p>}
        </div>
      ) : null}

      {kp.melhorDia && visao !== 'dias' && (
        <p className="px-1 text-[12px] text-text-muted">Dia de maior compra: {fmtDM(kp.melhorDia.dia)} (<Money value={kp.melhorDia.valor} />).</p>
      )}
    </div>
  )
}

